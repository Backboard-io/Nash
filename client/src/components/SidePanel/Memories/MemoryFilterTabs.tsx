import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export type MemoryScope = 'all' | 'global' | 'workspace' | 'persona' | 'chat';

interface MemoryFilterTabsProps {
  active: MemoryScope;
  onChange: (scope: MemoryScope) => void;
}

export default function MemoryFilterTabs({ active, onChange }: MemoryFilterTabsProps) {
  const localize = useLocalize();

  const tabs: { value: MemoryScope; label: Parameters<typeof localize>[0] }[] = [
    { value: 'all', label: 'com_ui_memory_scope_all' },
    { value: 'global', label: 'com_ui_memory_scope_global' },
    { value: 'workspace', label: 'com_ui_memory_scope_workspace' },
    { value: 'persona', label: 'com_ui_memory_scope_persona' },
    { value: 'chat', label: 'com_ui_memory_scope_chat' },
  ];

  return (
    <div
      role="tablist"
      aria-label={localize('com_ui_scope')}
      className="flex items-center gap-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => {
        const isActive = tab.value === active;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.value)}
            className={cn(
              'h-[33px] shrink-0 rounded-[8px] px-[14px] text-[12.5px] leading-[18.75px] transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isActive
                ? 'bg-[#ECEDEF] font-medium text-text-primary dark:bg-[#181A1E]'
                : 'border border-border-light text-text-secondary hover:bg-surface-hover',
            )}
          >
            {localize(tab.label)}
          </button>
        );
      })}
    </div>
  );
}
