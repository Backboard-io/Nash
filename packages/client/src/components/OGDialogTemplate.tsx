import { forwardRef, isValidElement, ReactNode, Ref } from 'react';
import {
  OGDialogTitle,
  OGDialogClose,
  OGDialogFooter,
  OGDialogHeader,
  OGDialogContent,
  OGDialogDescription,
} from './OriginalDialog';
import { useLocalize } from '~/hooks';
import { Button } from './Button';
import { Spinner } from '~/svgs';
import { cn } from '~/utils/';

type SelectionProps = {
  selectHandler?: () => void;
  selectClasses?: string;
  selectText?: string | ReactNode;
  isLoading?: boolean;
  /**
   * Confirm is unavailable — an unchanged form, an empty required field.
   * Distinct from `isLoading`, which also disables but swaps the label for a
   * spinner. §4: disabled means unreachable, not hidden.
   */
  disabled?: boolean;
};

/**
 * Type guard to check if selection is a legacy SelectionProps object
 */
function isSelectionProps(selection: unknown): selection is SelectionProps {
  return (
    typeof selection === 'object' &&
    selection !== null &&
    !isValidElement(selection) &&
    ('selectHandler' in selection ||
      'selectClasses' in selection ||
      'selectText' in selection ||
      'isLoading' in selection)
  );
}

type DialogTemplateProps = {
  title: string;
  description?: string;
  main?: ReactNode;
  buttons?: ReactNode;
  leftButtons?: ReactNode;
  /**
   * Selection button configuration. Can be either:
   * - An object with selectHandler, selectClasses, selectText, isLoading (legacy)
   * - A ReactNode for custom selection component
   * @example
   * // Legacy usage
   * selection={{ selectHandler: () => {}, selectText: 'Confirm' }}
   * @example
   * // Custom component
   * selection={<Button onClick={handleConfirm}>Confirm</Button>}
   */
  selection?: SelectionProps | ReactNode;
  className?: string;
  overlayClassName?: string;
  headerClassName?: string;
  mainClassName?: string;
  footerClassName?: string;
  showCloseButton?: boolean;
  showCancelButton?: boolean;
  onClose?: () => void;
};

const OGDialogTemplate = forwardRef((props: DialogTemplateProps, ref: Ref<HTMLDivElement>) => {
  const localize = useLocalize();
  const {
    title,
    main,
    buttons,
    selection,
    className,
    leftButtons,
    description = '',
    mainClassName,
    headerClassName,
    footerClassName,
    showCloseButton = false,
    overlayClassName,
    showCancelButton = true,
  } = props;
  const isLegacySelection = isSelectionProps(selection);
  const {
    selectHandler,
    selectClasses,
    selectText,
    isLoading,
    disabled: selectDisabled,
  } = isLegacySelection ? selection : {};

  const defaultSelect =
    'bg-gray-800 text-white transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-200 dark:text-gray-800 dark:hover:bg-gray-200';

  let selectionContent = null;
  if (isLegacySelection) {
    selectionContent = (
      <OGDialogClose
        onClick={selectHandler}
        disabled={isLoading === true || selectDisabled === true}
        className={`${
          selectClasses ?? defaultSelect
        } flex h-10 items-center justify-center rounded-lg border-none px-4 py-2 text-sm disabled:opacity-80 max-sm:order-first max-sm:w-full sm:order-none`}
      >
        {isLoading === true ? (
          <Spinner className="size-4 text-text-primary" />
        ) : (
          (selectText as React.JSX.Element)
        )}
      </OGDialogClose>
    );
  } else if (selection) {
    selectionContent = selection;
  }

  return (
    <OGDialogContent
      overlayClassName={overlayClassName}
      showCloseButton={showCloseButton}
      ref={ref}
      /* No `bg-background` here. §7: one fill for everything that opens over
         the page, and it is --elevated — the shared dialog shell already sets
         it. Painting the page fill back on at this level put every confirm in
         the app a rung below every other overlay, which is why the delete
         dialogs looked like a different, older component. */
      className={cn('w-11/12 border-none text-foreground', className ?? '')}
      onClick={(e) => e.stopPropagation()}
    >
      <OGDialogHeader className={cn(headerClassName ?? '')}>
        <OGDialogTitle>{title}</OGDialogTitle>
        {description && (
          <OGDialogDescription className="items-center justify-center">
            {description}
          </OGDialogDescription>
        )}
      </OGDialogHeader>
      <div className={cn('px-0 py-2', mainClassName)}>{main != null ? main : null}</div>
      <OGDialogFooter className={footerClassName}>
        {leftButtons != null ? (
          <div className="mr-auto flex flex-row gap-2">{leftButtons}</div>
        ) : null}
        {showCancelButton && (
          <OGDialogClose asChild>
            {/* §4 `.ghost`, and §7 says so by name: "Cancel — no fill until
                hovered. Never outlined; an outline makes it compete." An
                outlined Cancel beside a filled Delete reads as two buttons of
                equal weight on a question with one safe answer. */}
            <Button
              variant="ghost"
              aria-label={localize('com_ui_cancel')}
              className="h-10 rounded-[10px] border-0 bg-transparent px-4 text-[13.5px] font-medium text-text-secondary shadow-none hover:bg-surface-active hover:text-text-primary"
            >
              {localize('com_ui_cancel')}
            </Button>
          </OGDialogClose>
        )}
        {buttons != null ? buttons : null}
        {selectionContent}
      </OGDialogFooter>
    </OGDialogContent>
  );
});

export default OGDialogTemplate;
