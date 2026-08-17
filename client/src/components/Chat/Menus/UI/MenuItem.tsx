import type { FC } from 'react';
import { Check } from 'lucide-react';
import { cn } from '~/utils';

type MenuItemProps = {
  title: string;
  value?: string;
  selected: boolean;
  description?: string;
  onClick?: () => void;
  hoverCondition?: boolean;
  hoverContent?: React.ReactNode;
  children?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
  textClassName?: string;
  // hoverContent?: string;
} & Record<string, unknown>;

const MenuItem: FC<MenuItemProps> = ({
  title,
  // value,
  description,
  selected,
  // hoverCondition = true,
  // hoverContent,
  icon,
  className = '',
  textClassName = '',
  children,
  onClick,
  ...rest
}) => {
  return (
    <div
      id={selected ? 'selected-endpoint' : undefined}
      role="option"
      aria-selected={selected}
      aria-label={title}
      data-testid="chat-menu-item"
      className={cn(
        'group m-1.5 flex cursor-pointer gap-2 rounded px-5 py-2.5 !pr-3 text-sm !opacity-100 hover:bg-black/5 focus:ring-0 radix-disabled:pointer-events-none radix-disabled:opacity-50 dark:hover:bg-gray-600 md:min-w-[240px]',
        className || '',
      )}
      tabIndex={0} // Change to 0 to make it focusable
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (onClick) {
            onClick();
          }
        }
      }}
      {...rest}
    >
      <div className="flex grow items-center justify-between gap-2">
        <div>
          <div className={cn('flex items-center gap-1')}>
            {icon != null ? icon : null}
            <div className={cn('truncate', textClassName)}>
              {title}
              <div className="text-token-text-tertiary">{description}</div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {children}
          {/* §12: a plain tick. The row's own fill already says it is
              selected; the mark only agrees with it. */}
          {selected && <Check size={16} className="shrink-0" aria-hidden="true" />}
        </div>
      </div>
    </div>
  );
};

export default MenuItem;
