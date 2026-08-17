import React, { useState, useEffect, useCallback } from 'react';
import SearchField from '~/components/ui/SearchField';
import { useDebounce, useLocalize } from '~/hooks';

/**
 * Props for the SearchBar component
 */
interface SearchBarProps {
  /** Current search query value */
  value: string;
  /** Callback fired when the search query changes */
  onSearch: (query: string) => void;
  /** Additional CSS classes */
  className?: string;
}

/**
 * The persona search: the shared `SearchField` plus a 300ms debounce, so the
 * marketplace is not queried on every keystroke.
 *
 * It used to be its own field with its own 20px magnifier, which made it read
 * heavier than the identical search on Bookmarks. The field is now one
 * component and the only thing left here is the debounce.
 */
const SearchBar: React.FC<SearchBarProps> = ({ value, onSearch, className = '' }) => {
  const localize = useLocalize();
  const [searchTerm, setSearchTerm] = useState(value);

  // Debounced search value (300ms delay)
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  // Update internal state when props change
  useEffect(() => {
    setSearchTerm(value);
  }, [value]);

  // Trigger search when debounced value changes
  useEffect(() => {
    // Only trigger search if the debounced value matches current searchTerm
    // This prevents stale debounced values from triggering after clear
    if (debouncedSearchTerm !== value && debouncedSearchTerm === searchTerm) {
      onSearch(debouncedSearchTerm);
    }
  }, [debouncedSearchTerm, onSearch, value, searchTerm]);

  /**
   * Clear the search input and reset results
   */
  const handleClear = useCallback(() => {
    // Immediately call parent onSearch to clear the URL parameter
    onSearch('');
    // Also clear local state
    setSearchTerm('');
  }, [onSearch]);

  return (
    <>
      <SearchField
        id="agent-search"
        className={`w-full ${className}`}
        value={searchTerm}
        onChange={setSearchTerm}
        onClear={handleClear}
        placeholder={localize('com_agents_search_placeholder')}
        ariaLabel={localize('com_agents_search_aria')}
        inputProps={{ 'aria-describedby': 'search-instructions search-results-count' }}
      />
      <div id="search-instructions" className="sr-only">
        {localize('com_agents_search_instructions')}
      </div>
    </>
  );
};

export default SearchBar;
