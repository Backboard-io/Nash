import { useMemo } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { Label, Input, SecretInput, Radio } from '@librechat/client';
import { AuthTypeEnum, AuthorizationTypeEnum } from '../hooks/useMCPServerForm';
import type { MCPServerFormData } from '../hooks/useMCPServerForm';
import { useLocalize } from '~/hooks';

// isEditMode/serverName retained for the shared section signature; unused in v1
// (static auth only — the OAuth redirect-URI helper lived here previously).
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

  // v1 supports static auth only (no key = None, or a shared API key sent as a
  // header). MCP OAuth is not yet implemented on the backend, so it is not
  // offered here.
  const authTypeOptions = useMemo(
    () => [
      { value: AuthTypeEnum.None, label: localize('com_ui_no_auth') },
      { value: AuthTypeEnum.ServiceHttp, label: localize('com_ui_api_key') },
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
    </div>
  );
}
