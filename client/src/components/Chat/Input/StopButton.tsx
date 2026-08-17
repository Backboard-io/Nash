import { TooltipAnchor } from '@librechat/client';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export default function StopButton({ stop, setShowStopButton }) {
  const localize = useLocalize();

  return (
    <TooltipAnchor
      description={localize('com_nav_stop_generating')}
      render={
        <button
          type="button"
          className={cn(
            'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-surface-submit sm:h-[34px] sm:w-[34px] text-white outline-offset-4 transition-all duration-hover hover:bg-surface-submit-hover active:bg-brand-purple-pressed disabled:cursor-not-allowed disabled:bg-surface-active disabled:text-text-secondary',
          )}
          aria-label={localize('com_nav_stop_generating')}
          onClick={(e) => {
            setShowStopButton(false);
            stop(e);
          }}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect x="7" y="7" width="10" height="10" rx="1.25" fill="currentColor"></rect>
          </svg>
        </button>
      }
    ></TooltipAnchor>
  );
}
