import { forwardRef } from 'react';
import { CheckIcon } from 'lucide-react';
import { Spinner, DialogButton, InfoHoverCard, ESide } from '@librechat/client';
import type { TDangerButtonProps } from '~/common';
import type { ForwardedRef } from 'react';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const DangerButton = (props: TDangerButtonProps, ref: ForwardedRef<HTMLButtonElement>) => {
  const {
    id,
    onClick,
    mutation,
    disabled,
    confirmClear,
    infoTextCode,
    actionTextCode,
    className = '',
    showText = true,
    dataTestIdInitial,
    dataTestIdConfirm,
    infoDescriptionCode,
    confirmActionTextCode = 'com_ui_confirm_action',
  } = props;
  const localize = useLocalize();

  const renderMutation = (node: React.ReactNode | string) => {
    if (mutation && mutation.isLoading) {
      return <Spinner className="h-5 w-5" />;
    }
    return node;
  };

  return (
    <div className="flex items-center justify-between">
      {showText && (
        <div className={`flex items-center ${infoDescriptionCode ? 'space-x-2' : ''}`}>
          <div>{localize(infoTextCode)}</div>
          {infoDescriptionCode && <InfoHoverCard side={ESide.Bottom} text={infoDescriptionCode} />}
        </div>
      )}
      <DialogButton
        id={id}
        ref={ref}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          'btn relative border-none bg-rose-500/10 font-medium text-rose-600 hover:bg-rose-500/20 dark:bg-rose-500/15 dark:text-rose-400 dark:hover:bg-rose-500/25',
          className,
        )}
      >
        {confirmClear ? (
          <div
            className="flex w-full items-center justify-center gap-2"
            id={`${id}-text`}
            data-testid={dataTestIdConfirm}
          >
            {renderMutation(<CheckIcon className="h-5 w-5" aria-hidden="true" />)}
            {mutation && mutation.isLoading ? null : localize(confirmActionTextCode)}
          </div>
        ) : (
          <div
            className="flex w-full items-center justify-center gap-2"
            id={`${id}-text`}
            data-testid={dataTestIdInitial}
          >
            {renderMutation(localize(actionTextCode))}
          </div>
        )}
      </DialogButton>
    </div>
  );
};

export default forwardRef(DangerButton);
