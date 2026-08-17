import { Globe } from 'lucide-react';
import { Spinner } from '@librechat/client';
import { useWatch, useFormContext } from 'react-hook-form';
import {
  SystemRoles,
  Permissions,
  ResourceType,
  PermissionBits,
  PermissionTypes,
} from 'librechat-data-provider';
import type { AgentForm, AgentPanelProps } from '~/common';
import { useLocalize, useAuthContext, useHasAccess, useResourcePermissions } from '~/hooks';
import { GenericGrantAccessDialog } from '~/components/Sharing';
import { useUpdateAgentMutation } from '~/data-provider';
import { getDefaultAgentFormValues } from '~/utils';
import VersionButton from './Version/VersionButton';
import DuplicateAgent from './DuplicateAgent';
import AdminSettings from './AdminSettings';
import DeleteButton from './DeleteButton';
import { Panel } from '~/common';

export default function AgentFooter({
  activePanel,
  createMutation,
  updateMutation,
  setActivePanel,
  setCurrentAgentId,
  isAvatarUploading = false,
}: Pick<
  AgentPanelProps,
  'setCurrentAgentId' | 'createMutation' | 'activePanel' | 'setActivePanel'
> & {
  updateMutation: ReturnType<typeof useUpdateAgentMutation>;
  isAvatarUploading?: boolean;
}) {
  const localize = useLocalize();
  const { user } = useAuthContext();

  const methods = useFormContext<AgentForm>();

  const { control, reset } = methods;
  const agent = useWatch({ control, name: 'agent' });
  const agent_id = useWatch({ control, name: 'id' });
  const hasAccessToShareAgents = useHasAccess({
    permissionType: PermissionTypes.AGENTS,
    permission: Permissions.SHARE,
  });
  const hasAccessToShareRemoteAgents = useHasAccess({
    permissionType: PermissionTypes.REMOTE_AGENTS,
    permission: Permissions.SHARE,
  });
  const { hasPermission, isLoading: permissionsLoading } = useResourcePermissions(
    ResourceType.AGENT,
    agent?._id || '',
  );
  const { hasPermission: hasRemoteAgentPermission, isLoading: remotePermissionsLoading } =
    useResourcePermissions(ResourceType.REMOTE_AGENT, agent?._id || '');

  const canShareThisAgent = hasPermission(PermissionBits.SHARE);
  const canDeleteThisAgent = hasPermission(PermissionBits.DELETE);
  const canShareRemoteAgent = hasRemoteAgentPermission(PermissionBits.SHARE);
  const isSaving = createMutation.isLoading || updateMutation.isLoading || isAvatarUploading;
  const renderSaveButton = () => {
    if (isSaving) {
      return <Spinner className="icon-md" aria-hidden="true" />;
    }

    if (agent_id) {
      return localize('com_ui_save_changes');
    }

    return localize('com_ui_create_persona');
  };

  const showButtons = activePanel === Panel.builder;

  const handleCancel = () => {
    reset(getDefaultAgentFormValues());
    setCurrentAgentId(undefined);
  };

  return (
    <div className="mb-1 flex w-full flex-col gap-2">
      {showButtons && agent_id && <VersionButton setActivePanel={setActivePanel} />}
      {user?.role === SystemRoles.ADMIN && showButtons && <AdminSettings />}
      {/* Secondary controls: share / duplicate / delete */}
      <div className="flex items-center justify-end gap-2 empty:hidden">
        {(agent?.author === user?.id || user?.role === SystemRoles.ADMIN || canShareThisAgent) &&
          hasAccessToShareAgents &&
          !permissionsLoading && (
            <GenericGrantAccessDialog
              resourceDbId={agent?._id}
              resourceId={agent_id}
              resourceName={agent?.name ?? ''}
              resourceType={ResourceType.AGENT}
            />
          )}
        {(agent?.author === user?.id || user?.role === SystemRoles.ADMIN || canShareRemoteAgent) &&
          hasAccessToShareRemoteAgents &&
          !remotePermissionsLoading &&
          agent?._id && (
            <GenericGrantAccessDialog
              resourceDbId={agent?._id}
              resourceId={agent_id}
              resourceName={agent?.name ?? ''}
              resourceType={ResourceType.REMOTE_AGENT}
            >
              <button
                type="button"
                className="btn btn-neutral border-token-border-light h-9 px-3"
                title={localize('com_ui_remote_access')}
              >
                <Globe className="h-4 w-4" aria-hidden="true" />
              </button>
            </GenericGrantAccessDialog>
          )}
        {agent && agent.author === user?.id && <DuplicateAgent agent_id={agent_id} />}
        {(agent?.author === user?.id || user?.role === SystemRoles.ADMIN || canDeleteThisAgent) &&
          !permissionsLoading && (
            <DeleteButton
              agent_id={agent_id}
              setCurrentAgentId={setCurrentAgentId}
              createMutation={createMutation}
            />
          )}
      </div>
      {/* Primary actions: Save + Cancel */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            className="focus:shadow-outline flex h-9 items-center justify-center rounded-lg bg-brand-purple px-4 py-2 font-semibold text-brand-purple-foreground transition-colors hover:bg-brand-purple-hover disabled:opacity-60"
            type="submit"
            disabled={isSaving}
            aria-busy={isSaving}
          >
            {renderSaveButton()}
          </button>
          {showButtons && (
            <button
              type="button"
              onClick={handleCancel}
              className="btn btn-neutral border-token-border-light h-9 rounded-lg px-4 font-medium"
            >
              {localize('com_ui_cancel')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
