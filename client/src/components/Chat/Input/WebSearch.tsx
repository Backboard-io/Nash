import React, { memo } from 'react';
import { Globe } from 'lucide-react';
import { TooltipAnchor } from '@librechat/client';
import { Permissions, PermissionTypes } from 'librechat-data-provider';
import { useLocalize, useHasAccess } from '~/hooks';
import { useBadgeRowContext } from '~/Providers';
import { cn } from '~/utils';

function WebSearch() {
  const localize = useLocalize();
  const { webSearch: webSearchData, searchApiKeyForm } = useBadgeRowContext();
  const { toggleState: webSearch, debouncedChange } = webSearchData;
  const { badgeTriggerRef } = searchApiKeyForm;

  const canUseWebSearch = useHasAccess({
    permissionType: PermissionTypes.WEB_SEARCH,
    permission: Permissions.USE,
  });

  if (!canUseWebSearch) {
    return null;
  }

  const label = webSearch ? localize('com_ui_on') : localize('com_ui_off');

  return (
    <TooltipAnchor
      description={localize('com_ui_web_search')}
      render={
        <button
          ref={badgeTriggerRef as unknown as React.Ref<HTMLButtonElement>}
          type="button"
          onClick={() => debouncedChange({ e: undefined, value: !webSearch })}
          aria-pressed={webSearch}
          aria-label={`${localize('com_ui_web_search')}: ${label}`}
          className={cn(
            'flex h-9 max-w-fit items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors',
            webSearch
              ? 'border-[#4F48D9]/40 bg-[#635BFF]/10 text-[#4F48D9] hover:bg-[#4F48D9]/10 dark:text-[#B9B5FF]'
              : 'border-border-light bg-transparent text-text-tertiary hover:bg-surface-hover',
          )}
        >
          <Globe className="h-4 w-4" aria-hidden="true" />
          <span>{label}</span>
        </button>
      }
    />
  );
}

export default memo(WebSearch);
