import React, { memo, useMemo, useState } from 'react';
import * as Ariakit from '@ariakit/react';
import { Brain, Check } from 'lucide-react';
import { Permissions, PermissionTypes } from 'librechat-data-provider';
import { useRecoilValue } from 'recoil';
import { TooltipAnchor, DropdownPopup } from '@librechat/client';
import type { MenuItemProps } from '~/common';
import { useLocalize, useHasAccess } from '~/hooks';
import { useBadgeRowContext } from '~/Providers';
import store from '~/store';
import { cn } from '~/utils';

type MemoryMode = 'Auto' | 'Readonly' | 'Off';

const MODE_CYCLE: MemoryMode[] = ['Auto', 'Readonly', 'Off'];

const MODE_LABEL: Record<MemoryMode, string> = {
  Auto: 'Auto',
  Readonly: 'Read',
  Off: 'Off',
};

function normalizeMode(value: unknown): MemoryMode {
  if (value === 'Auto' || value === 'Readonly' || value === 'Off') {
    return value as MemoryMode;
  }
  return 'Auto';
}

function MemoryToggle() {
  const localize = useLocalize();
  const { memory: memoryData } = useBadgeRowContext();
  const { toolValue, handleChange } = memoryData;
  const isTemporary = useRecoilValue(store.isTemporary);
  const [isOpen, setIsOpen] = useState(false);

  const canUseMemories = useHasAccess({
    permissionType: PermissionTypes.MEMORIES,
    permission: Permissions.USE,
  });

  const mode = useMemo(
    () => (isTemporary ? 'Off' : normalizeMode(toolValue)),
    [isTemporary, toolValue],
  );

  const items = useMemo<MenuItemProps[]>(
    () =>
      MODE_CYCLE.map((m) => ({
        label: MODE_LABEL[m],
        ariaChecked: mode === m,
        onClick: () => handleChange({ value: m }),
        icon: (
          <Check
            className={cn('size-4', mode === m ? 'opacity-100' : 'opacity-0')}
            aria-hidden="true"
          />
        ),
      })),
    [mode, handleChange],
  );

  if (!canUseMemories) {
    return null;
  }

  return (
    <DropdownPopup
      menuId="composer-memory-menu"
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      portal={true}
      unmountOnHide={true}
      trigger={
        <TooltipAnchor
          description={`${localize('com_ui_memory')}: ${MODE_LABEL[mode]}`}
          render={
            <Ariakit.MenuButton
              disabled={isTemporary}
              aria-label={`${localize('com_ui_memory')}: ${MODE_LABEL[mode]}`}
              className={cn(
                'flex h-[34px] w-[34px] items-center justify-center rounded-full bg-surface-active text-text-secondary',
                'transition-colors hover:bg-surface-hover',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                mode !== 'Auto' && !isTemporary && 'text-brand-purple',
                isTemporary && 'cursor-not-allowed opacity-50',
              )}
            >
              <Brain size={17} aria-hidden="true" />
            </Ariakit.MenuButton>
          }
        />
      }
      items={items}
    />
  );
}

export default memo(MemoryToggle);
