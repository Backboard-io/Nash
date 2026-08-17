import React, { memo } from 'react';
import { TerminalSquareIcon } from 'lucide-react';
import { CheckboxButton } from '@librechat/client';
import { PermissionTypes, Permissions } from 'librechat-data-provider';
import { useLocalize, useHasAccess } from '~/hooks';
import { useBadgeRowContext } from '~/Providers';

function CodeInterpreter() {
  const localize = useLocalize();
  const { codeInterpreter, codeApiKeyForm } = useBadgeRowContext();
  const { toggleState: runCode, debouncedChange, isPinned } = codeInterpreter;
  const { badgeTriggerRef } = codeApiKeyForm;

  const canRunCode = useHasAccess({
    permissionType: PermissionTypes.RUN_CODE,
    permission: Permissions.USE,
  });

  if (!canRunCode) {
    return null;
  }

  return (
    (runCode || isPinned) && (
      <CheckboxButton
        ref={badgeTriggerRef}
        className="max-w-fit"
        checked={runCode}
        setValue={debouncedChange}
        label={localize('com_assistants_code_interpreter')}
        isCheckedClassName="border-[#4F48D9]/40 bg-[#635BFF]/10 hover:bg-[#4F48D9]/10"
        icon={<TerminalSquareIcon className="icon-md" aria-hidden="true" />}
      />
    )
  );
}

export default memo(CodeInterpreter);
