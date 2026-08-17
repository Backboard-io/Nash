import { logger } from '@librechat/data-schemas';
import { backboardStorage } from './storage';

const AGENT_MAP_TYPE = 'librechat_agent_map';

interface AgentSyncParams {
  agentId: string;
  name: string;
  description?: string;
  instructions?: string;
}

/** Syncs a LibreChat agent to a Backboard assistant, returning the Backboard assistantId. */
export async function syncAgentToBackboard(params: AgentSyncParams): Promise<string> {
  const bb = backboardStorage.getClient();

  const existing = await backboardStorage.findByMetadata(
    AGENT_MAP_TYPE,
    'agentId',
    params.agentId,
  );

  if (existing) {
    const bbAssistantId = existing.metadata.bbAssistantId as string;
    logger.info(`[Backboard Agents] Agent ${params.agentId} already mapped to ${bbAssistantId}`);
    return bbAssistantId;
  }

  const assistant = await bb.createAssistant(
    params.name,
    params.description ?? params.instructions?.slice(0, 200) ?? '',
  );

  await backboardStorage.createItem(
    `Agent mapping: ${params.agentId} → ${assistant.assistant_id}`,
    {
      type: AGENT_MAP_TYPE,
      agentId: params.agentId,
      bbAssistantId: assistant.assistant_id,
      name: params.name,
    },
  );

  logger.info(
    `[Backboard Agents] Created assistant ${assistant.assistant_id} for agent ${params.agentId}`,
  );
  return assistant.assistant_id;
}

/** Looks up the Backboard assistantId for a LibreChat agentId. */
export async function getBackboardAssistantId(agentId: string): Promise<string | null> {
  const existing = await backboardStorage.findByMetadata(
    AGENT_MAP_TYPE,
    'agentId',
    agentId,
  );

  if (!existing) {
    return null;
  }
  return existing.metadata.bbAssistantId as string;
}

/** Deletes the Backboard assistant mapping (and optionally the assistant itself). */
export async function deleteAgentMapping(
  agentId: string,
  deleteAssistant = false,
): Promise<boolean> {
  const existing = await backboardStorage.findByMetadata(
    AGENT_MAP_TYPE,
    'agentId',
    agentId,
  );

  if (!existing) {
    return false;
  }

  if (deleteAssistant) {
    try {
      const bb = backboardStorage.getClient();
      await bb.deleteAssistant(existing.metadata.bbAssistantId as string);
    } catch (err) {
      logger.warn(`[Backboard Agents] Failed to delete assistant: ${err}`);
    }
  }

  return backboardStorage.deleteItem(existing.id);
}

/** Lists all agent-to-assistant mappings. */
export async function listAgentMappings(): Promise<
  Array<{ agentId: string; bbAssistantId: string; name: string }>
> {
  const items = await backboardStorage.listByType(AGENT_MAP_TYPE);
  return items.map((item) => ({
    agentId: item.metadata.agentId as string,
    bbAssistantId: item.metadata.bbAssistantId as string,
    name: (item.metadata.name as string) ?? '',
  }));
}
