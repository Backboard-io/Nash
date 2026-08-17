import { useLocalize } from '~/hooks';
import FilterPill from '~/components/ui/FilterPill';

export type BookmarkCategory =
  | 'all'
  | 'responses'
  | 'code'
  | 'artifacts'
  | 'files'
  | 'images'
  | 'tools'
  | 'prompts';

interface BookmarkFilterTabsProps {
  active: BookmarkCategory;
  onChange: (category: BookmarkCategory) => void;
}

export default function BookmarkFilterTabs({ active, onChange }: BookmarkFilterTabsProps) {
  const localize = useLocalize();

  const tabs: { value: BookmarkCategory; label: Parameters<typeof localize>[0] }[] = [
    { value: 'all', label: 'com_ui_bookmark_category_all' },
    { value: 'responses', label: 'com_ui_bookmark_category_responses' },
    { value: 'code', label: 'com_ui_bookmark_category_code' },
    { value: 'artifacts', label: 'com_ui_bookmark_category_artifacts' },
    { value: 'files', label: 'com_ui_bookmark_category_files' },
    { value: 'images', label: 'com_ui_bookmark_category_images' },
    { value: 'tools', label: 'com_ui_bookmark_category_tools' },
    { value: 'prompts', label: 'com_ui_bookmark_category_prompts' },
  ];

  return (
    <div
      role="tablist"
      aria-label={localize('com_ui_bookmarks')}
      className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => (
        <FilterPill
          key={tab.value}
          role="tab"
          aria-selected={tab.value === active}
          selected={tab.value === active}
          onClick={() => onChange(tab.value)}
        >
          {localize(tab.label)}
        </FilterPill>
      ))}
    </div>
  );
}
