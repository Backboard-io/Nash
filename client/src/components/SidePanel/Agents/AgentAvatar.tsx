import { useEffect, useCallback } from 'react';
import { useToastContext } from '@librechat/client';
import { useFormContext, useWatch } from 'react-hook-form';
import { mergeFileConfig, fileConfig as defaultFileConfig } from 'librechat-data-provider';
import type { AgentAvatar } from 'librechat-data-provider';
import type { AgentForm } from '~/common';
import { AgentAvatarRender, NoImage, AvatarMenu } from './Images';
import { useGetFileConfig } from '~/data-provider';
import { useLocalize } from '~/hooks';

function Avatar({ avatar }: { avatar: AgentAvatar | null }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { control, setValue } = useFormContext<AgentForm>();
  const avatarPreview = useWatch({ control, name: 'avatar_preview' }) ?? '';
  const avatarAction = useWatch({ control, name: 'avatar_action' });
  const { data: fileConfig = defaultFileConfig } = useGetFileConfig({
    select: (data) => mergeFileConfig(data),
  });

  // Derive whether agent has a remote avatar from the avatar prop
  const hasRemoteAvatar = Boolean(avatar?.filepath);

  useEffect(() => {
    if (avatarAction) {
      return;
    }

    if (avatar?.filepath && avatarPreview !== avatar.filepath) {
      setValue('avatar_preview', avatar.filepath);
    }

    if (!avatar?.filepath && avatarPreview !== '') {
      setValue('avatar_preview', '');
    }
  }, [avatar?.filepath, avatarAction, avatarPreview, setValue]);

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      const sizeLimit = fileConfig.avatarSizeLimit ?? 0;

      if (!file) {
        return;
      }

      if (sizeLimit && file.size > sizeLimit) {
        const limitInMb = sizeLimit / (1024 * 1024);
        const displayLimit = Number.isInteger(limitInMb)
          ? limitInMb
          : parseFloat(limitInMb.toFixed(1));
        showToast({
          message: localize('com_ui_upload_invalid_var', { 0: displayLimit }),
          status: 'error',
        });
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        setValue('avatar_file', file, { shouldDirty: true });
        setValue('avatar_preview', (reader.result as string) ?? '', { shouldDirty: true });
        setValue('avatar_action', 'upload', { shouldDirty: true });
      };
      reader.readAsDataURL(file);
    },
    [fileConfig.avatarSizeLimit, localize, setValue, showToast],
  );

  const handleReset = useCallback(() => {
    const remoteAvatarExists = Boolean(avatar?.filepath);
    setValue('avatar_preview', '', { shouldDirty: true });
    setValue('avatar_file', null, { shouldDirty: true });
    setValue('avatar_action', remoteAvatarExists ? 'reset' : null, { shouldDirty: true });
  }, [avatar?.filepath, setValue]);

  const hasIcon = Boolean(avatarPreview) || hasRemoteAvatar;
  const canReset = hasIcon;

  return (
    <div className="flex w-full items-center gap-4">
      <AvatarMenu
        trigger={
          <button
            type="button"
            className="h-16 w-16 overflow-hidden rounded-full outline-none ring-offset-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={localize('com_ui_upload_agent_avatar_label')}
          >
            {avatarPreview ? <AgentAvatarRender url={avatarPreview} /> : <NoImage />}
          </button>
        }
        handleFileChange={handleFileChange}
        onReset={handleReset}
        canReset={canReset}
      />
      <div className="flex flex-col">
        <span className="text-sm font-medium text-text-primary">
          {localize('com_ui_persona_avatar')}
        </span>
        <span className="text-xs text-text-secondary">
          {localize('com_ui_click_to_upload')}
        </span>
      </div>
    </div>
  );
}

export default Avatar;
