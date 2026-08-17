import * as React from 'react';
import * as Ariakit from '@ariakit/react';
import { ChevronRight, Search } from 'lucide-react';
import { cn } from '~/utils';

export const menuScrollbarClasses =
  '[&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-[2px] [&::-webkit-scrollbar-thumb]:bg-black/15 dark:[&::-webkit-scrollbar-thumb]:bg-white/15';

export interface CustomMenuProps extends Ariakit.MenuButtonProps<'div'> {
  label?: React.ReactNode;
  values?: Record<string, any>;
  onValuesChange?: (values: Record<string, any>) => void;
  searchValue?: string;
  onSearch?: (value: string) => void;
  combobox?: Ariakit.ComboboxProps['render'];
  comboboxLabel?: string;
  trigger?: Ariakit.MenuButtonProps['render'];
  defaultOpen?: boolean;
  /** Fixed content rendered between the search field and the scrollable list
   * (e.g. the model panel's tab bar and Personas row). */
  header?: React.ReactNode;
  /** Skip CustomMenu's own default trigger chrome (h-10/rounded-xl/padding/bg)
   * when `trigger` fully owns its own visual styling (e.g. the composer's pill
   * variant) — otherwise those defaults merge with the trigger's className and
   * fight it over shared properties like border-radius. */
  unstyled?: boolean;
}

export const CustomMenu = React.forwardRef<HTMLDivElement, CustomMenuProps>(function CustomMenu(
  {
    label,
    children,
    values,
    onValuesChange,
    searchValue,
    onSearch,
    combobox,
    comboboxLabel,
    trigger,
    defaultOpen,
    header,
    unstyled,
    ...props
  },
  ref,
) {
  const parent = Ariakit.useMenuContext();
  const searchable = searchValue != null || !!onSearch || !!combobox;

  const menuStore = Ariakit.useMenuStore({
    showTimeout: 100,
    placement: parent ? 'right' : 'top-end',
    defaultOpen: defaultOpen,
  });

  const listClasses = cn(
    'flex flex-col gap-px overflow-y-auto overscroll-contain',
    parent ? 'pb-1.5 pl-1.5 pr-1.5 pt-1' : 'pb-1.5 pl-1.5 pr-3 pt-1.5',
    menuScrollbarClasses,
  );

  const element = (
    <Ariakit.MenuProvider store={menuStore} values={values} setValues={onValuesChange}>
      <Ariakit.MenuButton
        ref={ref}
        {...props}
        className={cn(
          !parent &&
            !unstyled &&
            'flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-border-light px-3 py-2 text-sm text-text-primary',
          !parent &&
            !unstyled &&
            (menuStore.useState('open')
              ? 'bg-surface-active-alt hover:bg-surface-active-alt'
              : 'bg-presentation hover:bg-surface-active-alt'),
          parent && menuStore.useState('open') && 'bg-surface-hover',
          props.className,
        )}
        render={parent ? <CustomMenuItem render={trigger} /> : trigger}
      >
        <span className="min-w-0 flex-1">{label}</span>
        {parent ? (
          <ChevronRight size={14} className="ml-1 shrink-0 text-text-secondary" aria-hidden="true" />
        ) : (
          <Ariakit.MenuButtonArrow className="stroke-1 text-base opacity-75" />
        )}
      </Ariakit.MenuButton>
      <Ariakit.Menu
        open={menuStore.useState('open')}
        portal
        unmountOnHide
        gutter={parent ? 28 : 8}
        className={cn(
          parent ? 'animate-popover-left' : 'animate-popover',
          'outline-none! z-40 flex flex-col overflow-hidden text-text-primary',
          'border border-border-light bg-surface-secondary shadow-[0_8px_24px_rgba(0,0,0,0.4)]',
          parent
            ? 'max-h-[min(300px,var(--popover-available-height))] w-[260px] rounded-[14px]'
            : 'max-h-[min(380px,var(--popover-available-height))] w-[280px] rounded-[16px]',
          'max-w-[calc(100vw-2rem)]',
        )}
      >
        <SearchableContext.Provider value={searchable}>
          {searchable ? (
            <>
              <div className={cn('shrink-0', parent ? 'p-2 pb-1.5' : 'p-[10px] pb-1.5')}>
                <div
                  className={cn(
                    'flex items-center bg-surface-hover',
                    parent
                      ? 'h-[34px] gap-2 rounded-[8px] px-2.5'
                      : 'h-9 gap-2 rounded-[10px] px-3',
                  )}
                >
                  <Search
                    size={parent ? 13 : 14}
                    className="shrink-0 text-text-secondary"
                    aria-hidden="true"
                  />
                  <Ariakit.Combobox
                    autoSelect
                    aria-label={comboboxLabel}
                    render={combobox}
                    className={cn(
                      'w-full min-w-0 flex-1 border-none bg-transparent p-0 text-text-primary',
                      parent
                        ? 'text-[12px] leading-[18px]'
                        : 'text-[12.5px] leading-[18.75px]',
                      'placeholder:text-text-tertiary',
                      'focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0',
                    )}
                  />
                </div>
              </div>
              {header}
              <Ariakit.ComboboxList className={listClasses}>{children}</Ariakit.ComboboxList>
            </>
          ) : (
            <>
              {header}
              <div className={listClasses}>{children}</div>
            </>
          )}
        </SearchableContext.Provider>
      </Ariakit.Menu>
    </Ariakit.MenuProvider>
  );

  if (searchable) {
    return (
      <Ariakit.ComboboxProvider
        resetValueOnHide
        includesBaseElement={false}
        value={searchValue}
        setValue={onSearch}
      >
        {element}
      </Ariakit.ComboboxProvider>
    );
  }

  return element;
});

export const CustomMenuSeparator = React.forwardRef<HTMLHRElement, Ariakit.MenuSeparatorProps>(
  function CustomMenuSeparator(props, ref) {
    return (
      <Ariakit.MenuSeparator
        ref={ref}
        {...props}
        className={cn('my-0.5 h-0 w-full border-t border-border-light', props.className)}
      />
    );
  },
);

export interface CustomMenuGroupProps extends Ariakit.MenuGroupProps {
  label?: React.ReactNode;
}

export const CustomMenuGroup = React.forwardRef<HTMLDivElement, CustomMenuGroupProps>(
  function CustomMenuGroup({ label, ...props }, ref) {
    return (
      <Ariakit.MenuGroup ref={ref} {...props} className={cn('', props.className)}>
        {label && (
          <Ariakit.MenuGroupLabel className="cursor-default p-2 text-sm font-medium opacity-60 sm:py-1 sm:text-xs">
            {label}
          </Ariakit.MenuGroupLabel>
        )}
        {props.children}
      </Ariakit.MenuGroup>
    );
  },
);

const SearchableContext = React.createContext(false);

export interface CustomMenuItemProps extends Omit<Ariakit.ComboboxItemProps, 'store'> {
  name?: string;
}

export const CustomMenuItem = React.forwardRef<HTMLDivElement, CustomMenuItemProps>(
  function CustomMenuItem({ name, value, ...props }, ref) {
    const menu = Ariakit.useMenuContext();
    const searchable = React.useContext(SearchableContext);
    const defaultProps: CustomMenuItemProps = {
      ref,
      focusOnHover: true,
      blurOnHoverEnd: false,
      ...props,
      className: cn(
        'relative flex w-full min-w-0 cursor-default items-center rounded-[8px] px-[10px] outline-none! scroll-m-1 scroll-mt-[calc(var(--combobox-height,0px)+var(--label-height,4px))] aria-disabled:opacity-25 hover:bg-surface-hover data-[active-item]:bg-surface-hover',
        props.className,
      ),
    };

    const checkable = Ariakit.useStoreState(menu, (state) => {
      if (!name) {
        return false;
      }
      if (value == null) {
        return false;
      }
      return state?.values[name] != null;
    });

    const checked = Ariakit.useStoreState(menu, (state) => {
      if (!name) {
        return false;
      }
      return state?.values[name] === value;
    });

    // If the item is checkable, we render a checkmark icon next to the label.
    if (checkable) {
      defaultProps.children = (
        <React.Fragment>
          <span className="flex-1">{defaultProps.children}</span>
          <Ariakit.MenuItemCheck checked={checked} />
          {searchable && (
            // When an item is displayed in a search menu as a role=option
            // element instead of a role=menuitemradio, we can't depend on the
            // aria-checked attribute. Although NVDA and JAWS announce it
            // accurately, VoiceOver doesn't. TalkBack does announce the checked
            // state, but misleadingly implies that a double tap will change the
            // state, which isn't the case. Therefore, we use a visually hidden
            // element to indicate whether the item is checked or not, ensuring
            // cross-browser/AT compatibility.
            <Ariakit.VisuallyHidden>{checked ? 'checked' : 'not checked'}</Ariakit.VisuallyHidden>
          )}
        </React.Fragment>
      );
    }

    // If the item is not rendered in a search menu (listbox), we can render it
    // as a MenuItem/MenuItemRadio.
    if (!searchable) {
      if (name != null && value != null) {
        const radioProps = { ...defaultProps, name, value, hideOnClick: true };
        return <Ariakit.MenuItemRadio {...radioProps} />;
      }
      return <Ariakit.MenuItem {...defaultProps} />;
    }

    return (
      <Ariakit.ComboboxItem
        {...defaultProps}
        setValueOnClick={false}
        value={checkable ? value : undefined}
        selectValueOnClick={() => {
          if (name == null || value == null) {
            return false;
          }
          // By default, clicking on a ComboboxItem will update the
          // selectedValue state of the combobox. However, since we're sharing
          // state between combobox and menu, we also need to update the menu's
          // values state.
          menu?.setValue(name, value);
          return true;
        }}
        hideOnClick={(event) => {
          // Make sure that clicking on a combobox item that opens a nested
          // menu/dialog does not close the menu.
          const expandable = event.currentTarget.hasAttribute('aria-expanded');
          if (expandable) {
            return false;
          }
          // By default, clicking on a ComboboxItem only closes its own popover.
          // However, since we're in a menu context, we also close all parent
          // menus.
          menu?.hideAll();
          return true;
        }}
      />
    );
  },
);
