import { useMemo } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { Label, Input, SecretInput, Radio } from '@librechat/client';
import { AuthTypeEnum, AuthorizationTypeEnum } from '../hooks/useMCPServerForm';
import type { MCPServerFormData } from '../hooks/useMCPServerForm';
import { useLocalize } from '~/hooks';

// isEditMode/serverName retained for the shared section signature; unused
// (the OAuth redirect-URI helper lives in the post-create dialog).
interface AuthSectionProps {
  isEditMode?: boolean;
  serverName?: string;
}

export default function AuthSection(_props: AuthSectionProps) {
  const localize = useLocalize();
  const { register, setValue } = useFormContext<MCPServerFormData>();

  const authType = useWatch<MCPServerFormData, 'auth.auth_type'>({
    name: 'auth.auth_type',
  }) as AuthTypeEnum;

  const authorizationType = useWatch<MCPServerFormData, 'auth.api_key_authorization_type'>({
    name: 'auth.api_key_authorization_type',
  }) as AuthorizationTypeEnum;

  const authTypeOptions = useMemo(
    () => [
      { value: AuthTypeEnum.None, label: localize('com_ui_no_auth') },
      { value: AuthTypeEnum.ServiceHttp, label: localize('com_ui_api_key') },
      { value: AuthTypeEnum.OAuth, label: localize('com_ui_oauth') },
    ],
    [localize],
  );

  const headerFormatOptions = useMemo(
    () => [
      { value: AuthorizationTypeEnum.Bearer, label: localize('com_ui_bearer') },
      { value: AuthorizationTypeEnum.Basic, label: localize('com_ui_basic') },
      { value: AuthorizationTypeEnum.Custom, label: localize('com_ui_custom') },
    ],
    [localize],
  );

  return (
    <div className="space-y-3">
      {/* Auth Type Radio */}
      <fieldset className="space-y-1.5">
        <legend>
          <Label id="auth-type-label" className="text-sm font-medium">
            {localize('com_ui_authentication')}
          </Label>
        </legend>
        <Radio
          options={authTypeOptions}
          value={authType || AuthTypeEnum.None}
          onChange={(val) => setValue('auth.auth_type', val as AuthTypeEnum)}
          fullWidth
          aria-labelledby="auth-type-label"
        />
      </fieldset>

      {/* API Key Fields */}
      {authType === AuthTypeEnum.ServiceHttp && (
        <div className="space-y-3 rounded-lg border border-border-light p-3">
          {/* API Key input */}
          <div className="space-y-1.5">
            <Label htmlFor="api_key" className="text-sm font-medium">
              {localize('com_ui_api_key')}
            </Label>
            <SecretInput id="api_key" placeholder="sk-..." {...register('auth.api_key')} />
          </div>

          {/* Header Format Radio */}
          <fieldset className="space-y-1.5">
            <legend>
              <Label id="header-format-label" className="text-sm font-medium">
                {localize('com_ui_header_format')}
              </Label>
            </legend>
            <Radio
              options={headerFormatOptions}
              value={authorizationType || AuthorizationTypeEnum.Bearer}
              onChange={(val) =>
                setValue('auth.api_key_authorization_type', val as AuthorizationTypeEnum)
              }
              fullWidth
              aria-labelledby="header-format-label"
            />
          </fieldset>

          {/* Custom header name */}
          {authorizationType === AuthorizationTypeEnum.Custom && (
            <div className="space-y-1.5">
              <Label htmlFor="custom_header" className="text-sm font-medium">
                {localize('com_ui_custom_header_name')}
              </Label>
              <Input
                id="custom_header"
                placeholder="X-Api-Key"
                {...register('auth.api_key_custom_header')}
              />
            </div>
          )}
        </div>
      )}

      {/* OAuth Fields — everything optional: Nash discovers the server's
          authorization settings (MCP auth spec) and registers itself when the
          provider supports dynamic client registration. Manual values are only
          needed for providers without registration support. */}
      {authType === AuthTypeEnum.OAuth && (
        <div className="space-y-3 rounded-lg border border-border-light p-3">
          <p className="text-xs text-text-secondary">{localize('com_ui_mcp_oauth_auto_hint')}</p>

          <div className="space-y-1.5">
            <Label htmlFor="oauth_client_id" className="text-sm font-medium">
              {localize('com_ui_mcp_oauth_client_id')}
            </Label>
            <Input
              id="oauth_client_id"
              placeholder={localize('com_ui_mcp_oauth_auto_placeholder')}
              {...register('auth.oauth_client_id')}
            />
            <p className="text-xs text-text-secondary">
              {localize('com_ui_mcp_oauth_client_id_hint')}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="oauth_client_secret" className="text-sm font-medium">
              {localize('com_ui_mcp_oauth_client_secret')}
            </Label>
            <SecretInput
              id="oauth_client_secret"
              placeholder={localize('com_ui_mcp_oauth_auto_placeholder')}
              {...register('auth.oauth_client_secret')}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="oauth_scope" className="text-sm font-medium">
              {localize('com_ui_mcp_oauth_scope')}
            </Label>
            <Input
              id="oauth_scope"
              placeholder={localize('com_ui_mcp_oauth_auto_placeholder')}
              {...register('auth.oauth_scope')}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="oauth_authorization_url" className="text-sm font-medium">
              {localize('com_ui_mcp_oauth_authorization_url')}
            </Label>
            <Input
              id="oauth_authorization_url"
              placeholder={localize('com_ui_mcp_oauth_auto_placeholder')}
              {...register('auth.oauth_authorization_url')}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="oauth_token_url" className="text-sm font-medium">
              {localize('com_ui_mcp_oauth_token_url')}
            </Label>
            <Input
              id="oauth_token_url"
              placeholder={localize('com_ui_mcp_oauth_auto_placeholder')}
              {...register('auth.oauth_token_url')}
            />
          </div>
        </div>
      )}
    </div>
  );
}
