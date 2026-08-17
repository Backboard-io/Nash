import { memo } from 'react';
import { useLocalize } from '~/hooks';

const PlaceholderRow = memo(() => {
  const localize = useLocalize();
  return (
    <div className="mt-1 flex h-[27px] items-center bg-transparent">
      <span
        className="animate-pulse select-none text-[13px] leading-[19.5px] text-text-secondary-alt"
        role="status"
        aria-live="polite"
      >
        {localize('com_ui_brewing')}
      </span>
    </div>
  );
});

export default PlaceholderRow;
