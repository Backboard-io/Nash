import * as React from 'react';
import RCInputNumber from 'rc-input-number';
import * as InputNumberPrimitive from 'rc-input-number';
import { cn } from '~/utils';

const InputNumber = React.forwardRef<
  React.ElementRef<typeof RCInputNumber>,
  InputNumberPrimitive.InputNumberProps
>(({ className, ...props }, ref) => {
  return (
    <RCInputNumber
      className={cn(
        'flex max-h-5 w-full rounded-md border border-gray-300 bg-transparent px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-50',
        className ?? '',
      )}
      ref={ref}
      {...props}
    />
  );
});
InputNumber.displayName = 'Input';

export { InputNumber };
