import React from 'react';
import { cn } from '~/utils';

export default function EmptyState({
  icon,
  title,
  description,
  action,
  tone = 'neutral',
  className,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  /** Usually a `.primary.sm` — the one thing to do from here. */
  action?: React.ReactNode;
  /** `error` is for a failed load, not for an empty list. */
  tone?: 'neutral' | 'error';
  className?: string;
}) {
  const isError = tone === 'error';

  return (
    <div
      className={cn(
        'flex w-full flex-col items-center justify-center gap-3 py-[54px] text-center',
        className,
      )}
    >
      <div
        className={cn(
          'flex size-14 items-center justify-center rounded-full [&_svg]:size-6',
          isError ? 'bg-surface-destructive-subtle' : 'bg-surface-hover',
        )}
      >
        <span className={isError ? 'text-text-destructive' : 'text-text-secondary-alt'}>
          {icon}
        </span>
      </div>
      <p className="text-[16px] font-medium leading-[24px] text-text-primary">{title}</p>
      {description != null && (
        <p className="max-w-[450px] text-[13px] leading-[19.5px] text-text-secondary-alt">
          {description}
        </p>
      )}
      {action != null && <div className="mt-1">{action}</div>}
    </div>
  );
}
