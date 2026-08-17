import React from 'react';
import * as Select from '@ariakit/react/select';
import { Check } from 'lucide-react';
import type { Option } from '~/common';
import { cn } from '~/utils/';
import './Dropdown.css';

interface DropdownProps {
  value?: string;
  label?: string;
  onChange: (value: string) => void;
  options: (string | Option | { divider: true })[];
  className?: string;
  sizeClasses?: string;
  testId?: string;
  icon?: React.ReactNode;
  iconOnly?: boolean;
  renderValue?: (option: Option) => React.ReactNode;
  ariaLabel?: string;
  'aria-labelledby'?: string;
  portal?: boolean;
}

const isDivider = (item: string | Option | { divider: true }): item is { divider: true } =>
  typeof item === 'object' && 'divider' in item;

const isOption = (item: string | Option | { divider: true }): item is Option =>
  typeof item === 'object' && 'value' in item && 'label' in item;

const Dropdown: React.FC<DropdownProps> = ({
  value: selectedValue,
  label = '',
  onChange,
  options,
  className = '',
  sizeClasses,
  testId = 'dropdown-menu',
  icon,
  iconOnly = false,
  renderValue,
  ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  portal = true,
}) => {
  const handleChange = (value: string) => {
    onChange(value);
  };

  const selectProps = Select.useSelectStore({
    value: selectedValue,
    setValue: handleChange,
  });

  const getOptionObject = (val: string | undefined): Option | undefined => {
    if (val == null || val === '') {
      return undefined;
    }
    return options
      .filter((o) => !isDivider(o))
      .map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
      .find((o) => isOption(o) && o.value === val) as Option | undefined;
  };

  const getOptionLabel = (currentValue: string | undefined) => {
    if (currentValue == null || currentValue === '') {
      return '';
    }
    const option = getOptionObject(currentValue);
    return option ? option.label : currentValue;
  };

  return (
    <div className={cn('relative', className)}>
      <Select.Select
        store={selectProps}
        className={cn(
          /* §6 `.targetbtn`: 40 tall, radius 10, on --surface, no border. This
             was `rounded-xl border border-input bg-background` — the page fill
             with a hairline — so on an --elevated panel it read as a hole
             rather than a control, and the two Dropdowns on one settings tab
             looked like two different widgets. */
          'relative inline-flex items-center justify-between rounded-[10px] border-0 bg-surface-control px-[14px] text-[13px] text-text-primary transition-colors hover:bg-surface-active focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border-heavy',
          iconOnly ? 'h-10 w-10' : 'h-10 w-fit gap-2',
          className,
        )}
        data-testid={testId}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
      >
        <div className="flex w-full items-center gap-2">
          {icon}
          {!iconOnly && (
            <span className="block truncate">
              {label}
              {(() => {
                const matchedOption = getOptionObject(selectedValue);
                if (matchedOption && renderValue) {
                  return renderValue(matchedOption);
                }
                return getOptionLabel(selectedValue);
              })()}
            </span>
          )}
        </div>
        {!iconOnly && <Select.SelectArrow />}
      </Select.Select>
      <Select.SelectPopover
        portal={portal}
        store={selectProps}
        className={cn(
          'popover-ui z-40',
          sizeClasses,
          className,
          'max-h-[80vh] overflow-y-auto',
          '[pointer-events:auto]', // Override body's pointer-events:none when in modal
        )}
      >
        {options.map((item, index) => {
          if (isDivider(item)) {
            return <div key={`divider-${index}`} className="my-[5px] h-px bg-border-light" />;
          }

          const option = typeof item === 'string' ? { value: item, label: item } : item;
          if (!isOption(option)) {
            return null;
          }

          return (
            <Select.SelectItem
              key={`option-${index}`}
              value={String(option.value)}
              className="select-item"
              data-theme={option.value}
            >
              <div className="flex w-full items-center gap-2">
                {option.icon != null && <span>{option.icon as React.ReactNode}</span>}
                <span className="block truncate">{option.label}</span>
                {/* A plain tick, not a filled circle-check: the selected row
                    already reads as selected, so the mark only has to confirm
                    it. The circle was a 24px solid disc — the heaviest thing
                    in the menu. */}
                {selectedValue === option.value && (
                  <Check size={16} className="ml-auto shrink-0" aria-hidden="true" />
                )}
              </div>
            </Select.SelectItem>
          );
        })}
      </Select.SelectPopover>
    </div>
  );
};

export default Dropdown;
