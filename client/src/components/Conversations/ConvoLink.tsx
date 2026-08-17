import React from 'react';
import { cn } from '~/utils';

interface ConvoLinkProps {
  isActiveConvo: boolean;
  isPopoverActive: boolean;
  title: string | null;
  onRename: () => void;
  isSmallScreen: boolean;
  localize: (key: any, options?: any) => string;
  children: React.ReactNode;
}

const ConvoLink: React.FC<ConvoLinkProps> = ({
  isActiveConvo,
  isPopoverActive,
  title,
  onRename,
  isSmallScreen,
  localize,
  children,
}) => {
  return (
    <div
      className="relative flex h-full min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-l-[8px] pl-[9px]"
      title={title ?? undefined}
      aria-current={isActiveConvo ? 'page' : undefined}
    >
      {children}
      <div
        className={cn(
          'relative min-w-0 flex-1 truncate text-[13px] leading-[19.5px]',
          // Row-states card: selected rows read primary; resting rows secondary.
          isActiveConvo ? 'text-text-primary' : 'text-text-primary dark:text-text-secondary',
        )}
        onDoubleClick={(e) => {
          if (isSmallScreen) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          onRename();
        }}
        aria-label={title || localize('com_ui_untitled')}
      >
        {title || localize('com_ui_untitled')}
      </div>
    </div>
  );
};

export default ConvoLink;
