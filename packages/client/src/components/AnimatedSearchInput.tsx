import React from 'react';
import { Search } from 'lucide-react';
import { useLocalize } from '~/hooks';

const AnimatedSearchInput = ({
  value,
  onChange,
  placeholder,
}: {
  value?: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  isSearching?: boolean;
  placeholder: string;
}) => {
  const localize = useLocalize();

  return (
    /* §6: "The Bookmarks page search is the standard… It is one component, not
       a spec each page reimplements." This was the opposite — blue and purple
       gradient washes, a blurred glow, a pinging blue dot, 500–700ms
       transitions and `text-gray-500` placeholders, none of which appear
       anywhere else in Nash. What survives is the geometry every other search
       field uses: 40 tall, radius 10, the control fill, no border and no focus
       ring, with a 16px glyph inset 12 from the left. */
    <div className="relative w-full">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-tertiary"
        aria-hidden="true"
      />
      <input
        type="text"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        aria-label={localize('com_ui_search')}
        className="h-10 w-full rounded-[10px] border-0 bg-surface-control pl-10 pr-3 text-[13px] text-text-primary transition-colors duration-hover placeholder:text-text-tertiary focus:outline-none"
      />
    </div>
  );
};

export default AnimatedSearchInput;
