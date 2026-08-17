import * as RadixToast from '@radix-ui/react-toast';
import { NotificationSeverity } from '~/common';
import { useToast } from '~/hooks';

export function Toast() {
  const { toast, onOpenChange } = useToast();

  /* One toast for every message in the app (DESIGN.md §4): an elevated slab,
   * primary copy, and colour spent ONLY on the leading icon. A fully coloured
   * panel shouts the same volume whatever it says, so severity is carried by
   * the glyph and the words do the rest. */
  const severityIconClass = {
    [NotificationSeverity.INFO]: 'text-text-tertiary',
    [NotificationSeverity.SUCCESS]: 'text-[#047252] dark:text-[#34D399]',
    [NotificationSeverity.WARNING]: 'text-[#A96A08] dark:text-[#E4A44C]',
    [NotificationSeverity.ERROR]: 'text-[#C4344E] dark:text-[#E85D75]',
  };

  return (
    <RadixToast.Root open={toast.open} onOpenChange={onOpenChange} className="toast-root">
      <div className="pointer-events-auto w-full px-6 md:w-auto">
        {/* Figma `.toast`: min-height 52, 13px radius, 14/18 padding, 12 gap,
            520 max width, 13.5px at 1.45. The fill lives in `.toast-root
            .alert-root`, with the shadow — both differ by theme, and a utility
            here would only be overridden by the stylesheet's specificity. */}
        <div
          className={
            'alert-root pointer-events-auto ml-auto flex min-h-[52px] w-full max-w-[460px] flex-row items-center gap-3 ' +
            'rounded-[13px] px-[18px] py-[14px] text-[13.5px] leading-[1.45] text-text-primary'
          }
        >
          {toast.showIcon && (
            <svg
              stroke="currentColor"
              fill="none"
              strokeWidth="2"
              viewBox="0 0 24 24"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`h-[18px] w-[18px] flex-shrink-0 ${severityIconClass[toast.severity]}`}
              aria-hidden="true"
            >
              <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          )}
          <RadixToast.Description className="min-w-0 flex-1">
            <div className="whitespace-pre-wrap text-left">{toast.message}</div>
          </RadixToast.Description>
          {/* One inline action, e.g. Undo — DESIGN.md §5 puts the undo for a
              single destructive step here rather than behind a confirm. */}
          {toast.action != null && (
            <RadixToast.Action
              altText={toast.action.label}
              onClick={toast.action.onClick}
              className="h-[30px] shrink-0 rounded-[8px] px-[10px] text-[13px] font-medium text-brand-purple transition-colors hover:bg-surface-active"
            >
              {toast.action.label}
            </RadixToast.Action>
          )}
          <RadixToast.Close
            aria-label="Dismiss"
            className="grid h-[28px] w-[28px] flex-shrink-0 place-items-center rounded-[7px] text-text-tertiary transition-colors hover:bg-surface-active hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <svg
              stroke="currentColor"
              fill="none"
              strokeWidth="2"
              viewBox="0 0 24 24"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-[15px] w-[15px]"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </RadixToast.Close>
        </div>
      </div>
    </RadixToast.Root>
  );
}
