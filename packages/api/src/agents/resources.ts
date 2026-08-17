import { logger } from '@librechat/data-schemas';
import { EModelEndpoint, EToolResources, AgentCapabilities } from 'librechat-data-provider';
import type { AgentToolResources, TFile, AgentBaseResource } from 'librechat-data-provider';
import type { IMongoFile, AppConfig, IUser } from '@librechat/data-schemas';
import type { Request as ServerRequest } from 'express';

export type TGetFiles = (
  filter: Record<string, unknown>,
  _sortOptions: Record<string, unknown> | null | undefined,
  selectFields: Record<string, unknown> | null | undefined,
  options?: { userId?: string; agentId?: string },
) => Promise<Array<TFile>>;

const addFileToResource = ({
  file,
  resourceType,
  tool_resources,
  processedResourceFiles,
}: {
  file: TFile;
  resourceType: EToolResources;
  tool_resources: AgentToolResources;
  processedResourceFiles: Set<string>;
}): void => {
  if (!file.file_id) {
    return;
  }

  const resourceKey = `${resourceType}:${file.file_id}`;
  if (processedResourceFiles.has(resourceKey)) {
    return;
  }

  const resource = tool_resources[resourceType as keyof AgentToolResources] ?? {};
  if (!resource.files) {
    (tool_resources[resourceType as keyof AgentToolResources] as AgentBaseResource) = {
      ...resource,
      files: [],
    };
  }

  const resourceFiles = tool_resources[resourceType as keyof AgentToolResources]?.files;
  const alreadyExists = resourceFiles?.some((f: TFile) => f.file_id === file.file_id);

  if (!alreadyExists) {
    resourceFiles?.push(file);
    processedResourceFiles.add(resourceKey);
  }
};

const categorizeFileForToolResources = ({
  file,
  tool_resources,
  requestFileSet,
  processedResourceFiles,
}: {
  file: TFile;
  tool_resources: AgentToolResources;
  requestFileSet: Set<string>;
  processedResourceFiles: Set<string>;
}): void => {
  if (file.metadata?.fileIdentifier) {
    addFileToResource({
      file,
      resourceType: EToolResources.execute_code,
      tool_resources,
      processedResourceFiles,
    });
    return;
  }

  if (file.embedded === true) {
    addFileToResource({
      file,
      resourceType: EToolResources.file_search,
      tool_resources,
      processedResourceFiles,
    });
    return;
  }

  if (
    requestFileSet.has(file.file_id) &&
    file.type.startsWith('image') &&
    file.height &&
    file.width
  ) {
    addFileToResource({
      file,
      resourceType: EToolResources.image_edit,
      tool_resources,
      processedResourceFiles,
    });
  }
};

export const primeResources = async ({
  req,
  appConfig,
  getFiles,
  requestFileSet,
  attachments: _attachments,
  tool_resources: _tool_resources,
  agentId,
}: {
  req: ServerRequest & { user?: IUser };
  appConfig?: AppConfig;
  requestFileSet: Set<string>;
  attachments: Promise<Array<TFile | null>> | undefined;
  tool_resources: AgentToolResources | undefined;
  getFiles: TGetFiles;
  agentId?: string;
}): Promise<{
  attachments: Array<TFile | undefined> | undefined;
  tool_resources: AgentToolResources | undefined;
}> => {
  try {
    const attachments: Array<TFile> = [];
    const attachmentFileIds = new Set<string>();
    const processedResourceFiles = new Set<string>();
    const tool_resources: AgentToolResources = { ...(_tool_resources ?? {}) };

    for (const [resourceType, resource] of Object.entries(tool_resources)) {
      if (!resource) {
        continue;
      }

      tool_resources[resourceType as keyof AgentToolResources] = {
        ...resource,
        ...(resource.files && { files: [...resource.files] }),
        ...(resource.file_ids && { file_ids: [...resource.file_ids] }),
        ...(resource.vector_store_ids && { vector_store_ids: [...resource.vector_store_ids] }),
      } as AgentBaseResource;

      if (resource.files && Array.isArray(resource.files)) {
        for (const file of resource.files) {
          if (file?.file_id) {
            processedResourceFiles.add(`${resourceType}:${file.file_id}`);
            if (resourceType !== EToolResources.context && resourceType !== EToolResources.ocr) {
              attachmentFileIds.add(file.file_id);
            }
          }
        }
      }
    }

    const isContextEnabled = (
      appConfig?.endpoints?.[EModelEndpoint.agents]?.capabilities ?? []
    ).includes(AgentCapabilities.context);

    const fileIds = tool_resources[EToolResources.context]?.file_ids ?? [];
    const ocrFileIds = tool_resources[EToolResources.ocr]?.file_ids;
    if (ocrFileIds != null) {
      fileIds.push(...ocrFileIds);
      delete tool_resources[EToolResources.ocr];
    }

    if (fileIds.length > 0 && isContextEnabled) {
      delete tool_resources[EToolResources.context];
      const requestUserId = req.user?.id;
      if (typeof requestUserId !== 'string') {
        const ctor =
          requestUserId != null && typeof requestUserId === 'object' && 'constructor' in requestUserId
            ? (requestUserId as { constructor?: { name?: string } }).constructor?.name ?? 'unknown'
            : 'n/a';
        logger.warn(
          `[agents/resources] getFiles context lookup with non-string req.user.id | type=${typeof requestUserId} ctor=${ctor} isArray=${Array.isArray(requestUserId)} agentId=${agentId} fileIds=${fileIds.length}`,
        );
      }
      const context = await getFiles(
        {
          file_id: { $in: fileIds },
        },
        {},
        {},
        { userId: req.user?.id, agentId },
      );

      for (const file of context) {
        if (!file?.file_id) {
          continue;
        }

        attachmentFileIds.delete(file.file_id);

        attachments.push(file);
        attachmentFileIds.add(file.file_id);

        categorizeFileForToolResources({
          file,
          tool_resources,
          requestFileSet,
          processedResourceFiles,
        });
      }
    }

    if (!_attachments) {
      return { attachments: attachments.length > 0 ? attachments : undefined, tool_resources };
    }

    const files = await _attachments;

    for (const file of files) {
      if (!file) {
        continue;
      }

      categorizeFileForToolResources({
        file,
        tool_resources,
        requestFileSet,
        processedResourceFiles,
      });

      if (file.file_id && attachmentFileIds.has(file.file_id)) {
        continue;
      }

      attachments.push(file);
      if (file.file_id) {
        attachmentFileIds.add(file.file_id);
      }
    }

    return { attachments: attachments.length > 0 ? attachments : [], tool_resources };
  } catch (error) {
    logger.error('Error priming resources', error);

    let safeAttachments: Array<TFile | undefined> = [];
    if (_attachments) {
      try {
        const attachmentFiles = await _attachments;
        safeAttachments = (attachmentFiles?.filter((file) => !!file) ?? []) as Array<TFile>;
      } catch (attachmentError) {
        logger.error('Error resolving attachments in catch block', attachmentError);
        safeAttachments = [];
      }
    }

    return {
      attachments: safeAttachments,
      tool_resources: _tool_resources,
    };
  }
};
