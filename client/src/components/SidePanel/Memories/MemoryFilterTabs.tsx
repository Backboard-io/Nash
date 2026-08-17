import { useLocalize } from '~/hooks';
import FilterPill from '~/components/ui/FilterPill';

export type MemoryScope = 'all' | 'global' | 'workspace' | 'persona' | 'chat';

interface MemoryFilterTabsProps {
  active: MemoryScope;
  onChange: (scope: MemoryScope) => void;
  /** Row count per scope, shown after each label as in the Figma screens. */
  counts?: Partial<Record<MemoryScope, number>>;
}

export default function MemoryFilterTabs({ active, onChange, counts }: MemoryFilterTabsProps) {
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
      {tabs.map((tab) => (
        <FilterPill
          key={tab.value}
          role="tab"
          aria-selected={tab.value === active}
          selected={tab.value === active}
          count={counts?.[tab.value]}
          onClick={() => onChange(tab.value)}
        >
          {localize(tab.label)}
        </FilterPill>
      ))}
    </div>
  );
}
