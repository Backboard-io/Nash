import { startTransition } from 'react';
import { TooltipAnchor, Button } from '@librechat/client';
import { PanelLeft } from 'lucide-react';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/** Element ID for the close sidebar button - used for focus management */
export const CLOSE_SIDEBAR_ID = 'close-sidebar-button';
/** Element ID for the open sidebar button - used for focus management */
export const OPEN_SIDEBAR_ID = 'open-sidebar-button';

export default function OpenSidebar({
  setNavVisible,
  className,
}: {
  setNavVisible: React.Dispatch<React.SetStateAction<boolean>>;
  className?: string;
}) {
  const localize = useLocalize();

  const handleClick = () => {
    // Use startTransition to mark this as a non-urgent update
    // This prevents blocking the main thread during the cascade of re-renders
    startTransition(() => {
      setNavVisible((prev) => {
        localStorage.setItem('navVisible', JSON.stringify(!prev));
        return !prev;
      });
    });
    // Delay focus until after the sidebar animation completes (200ms)
    setTimeout(() => {
      document.getElementById(CLOSE_SIDEBAR_ID)?.focus();
    }, 250);
  };

  return (
    <TooltipAnchor
      description={localize('com_nav_open_sidebar')}
      render={
        <Button
          id={OPEN_SIDEBAR_ID}
          size="icon"
          variant="ghost"
          data-testid="open-sidebar-button"
          aria-label={localize('com_nav_open_sidebar')}
          aria-expanded={false}
          aria-controls="chat-history-nav"
          /* The same button as the one inside the sidebar: 40 on mobile, 32
             and radius 8 on desktop, no fill and no outline at rest. It was an
             outlined `rounded-xl` box on --app, so closing the sidebar swapped
             a quiet icon for a bordered chip that sat at a different height. */
          className={cn(
            'h-10 w-10 rounded-full border-none bg-transparent text-text-secondary',
            'duration-0 hover:bg-surface-hover md:h-8 md:w-8 md:rounded-[8px]',
            'focus-visible:ring-inset focus-visible:ring-black focus-visible:ring-offset-0 dark:focus-visible:ring-white',
            className,
          )}
          onClick={handleClick}
        >
          {/* The same panel icon that closes it — reopening and closing the
              sidebar were two different marks for one toggle. */}
          <PanelLeft size={18} aria-hidden="true" />
        </Button>
      }
    />
  );
}
