import { useState, memo, useRef } from 'react';
import { useRecoilState } from 'recoil';
import * as Menu from '@ariakit/react/menu';
import { LogOut, Shield } from 'lucide-react';
import { Constants, SystemRoles } from 'librechat-data-provider';
import {
  LinkIcon,
  GearIcon,
  DropdownMenuSeparator,
  Avatar,
  useMediaQuery,
} from '@librechat/client';
import { useGetStartupConfig } from '~/data-provider';
import { useAuthContext } from '~/hooks/AuthContext';
import AdminUsersModal from './AdminUsersModal';
import Settings from './Settings';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import './nav.css';
import store from '~/store';

function AccountSettings({
  onNavigate,
  planName,
}: {
  onNavigate?: () => void;
  /** Resolved by the nav, which knows the org context the plan depends on. */
  planName?: string | null;
}) {
  const localize = useLocalize();
  const { user, logout } = useAuthContext();
  const { data: startupConfig } = useGetStartupConfig();
  const [showSettings, setShowSettings] = useRecoilState(store.showSettings);
  const [settingsInitialTab, setSettingsInitialTab] = useRecoilState(store.settingsInitialTab);
  const [showAdminUsers, setShowAdminUsers] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const accountSettingsButtonRef = useRef<HTMLButtonElement>(null);
  const isSmallScreen = useMediaQuery('(max-width: 768px)');

  /* §7: a flyout that belongs to a panel is drawn **beside** the panel, not
     over it. This one opened on top of the sidebar, covering the chats it was
     launched from. Same rule and the same numbers as the org switcher at the
     other end of the nav; on a small screen the drawer owns the width, so it
     drops instead. `right-end` rather than `right-start` because the account
     row sits at the bottom — aligning tops would run the menu off-screen. */
  const placement = isSmallScreen ? 'top-start' : 'right-end';

  const isAdmin = user?.role === SystemRoles.ADMIN;
  const isApiKeyUser = user?.provider === 'apikey';

  const displayName = isApiKeyUser
    ? user?.name || localize('com_nav_api_user')
    : (user?.name ?? user?.username ?? localize('com_nav_user'));

  const openSettings = () => {
    setIsMenuOpen(false);
    onNavigate?.();
    setShowSettings(true);
  };

  return (
    <Menu.MenuProvider open={isMenuOpen} setOpen={setIsMenuOpen} placement={placement}>
      <Menu.MenuButton
        ref={accountSettingsButtonRef}
        aria-label={localize('com_nav_account_settings')}
        data-testid="nav-user"
        className="flex h-12 w-full flex-shrink-0 items-center gap-2.5 rounded-[9px] px-[9px] transition-colors duration-hover ease-nash hover:bg-surface-hover aria-[expanded=true]:bg-surface-active"
      >
        {/* Figma avatar: 30px on the elevated fill, 12px initial. */}
        <div className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-hover">
          {(user?.avatar ?? '') !== '' ? (
            <Avatar user={user} size={30} />
          ) : (
            <span
              className="text-[12px] font-medium leading-[18px] text-text-secondary"
              aria-hidden="true"
            >
              {displayName.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <div className="flex min-w-0 grow flex-col gap-px text-left">
          <span className="truncate text-[12.5px] font-medium leading-[18.75px] text-text-primary">
            {displayName}
          </span>
          {/* The plan, not the address. The email is already the first line of
              the menu this button opens, so printing it here spent the
              sidebar's one spare line repeating what is one click away — and
              the plan is the thing you cannot find anywhere else. */}
          <span className="truncate text-[11px] leading-[16.5px] text-text-secondary-alt">
            {planName ? `${planName} plan` : 'No active plan'}
          </span>
        </div>
        <GearIcon className="h-3.5 w-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
      </Menu.MenuButton>
      <Menu.Menu
        /* `rounded-lg` was overriding `.popover-ui`'s radius; the shared class
           owns the shape now. */
        className={cn(
          'account-settings-popover popover-ui z-[125] w-[305px] max-w-[calc(100vw-2rem)] md:w-[244px]',
          /* Travels out of the panel's edge and settles (nav.css) — the same
             entrance the org flyout uses. */
          'nash-flyout',
          isSmallScreen && 'nash-flyout-down',
        )}
        modal={false}
        portal
        /* Ariakit measures from the TRIGGER, which the nav's px-3 insets 12px
           from the panel edge — so 24 lands the menu 12px clear of it. */
        gutter={isSmallScreen ? 8 : 24}
        shift={isSmallScreen ? 0 : 4}
        style={{ transformOrigin: isSmallScreen ? 'bottom' : 'left' }}
      >
        {/* Who you are signed in as, and what that account is on. Both are
            reference — §2's meta sizes, below a menu row's own type — but the
            account is --t3 because it is the one fact the menu exists to
            confirm, and the plan and build sit a tone quieter beneath it. */}
        <div className="flex flex-col gap-px px-[10px] py-[7px]" role="note">
          <span className="truncate text-[12px] leading-[17px] text-text-secondary-alt">
            {isApiKeyUser
              ? user?.name || localize('com_nav_api_user')
              : (user?.email ?? localize('com_nav_user'))}
          </span>
          <span className="flex min-w-0 items-center gap-1 text-[10.5px] leading-[15.75px] text-text-tertiary">
            <span className="min-w-0 truncate">
              {planName ? `${planName} plan` : 'No active plan'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0">Nash {String(Constants.VERSION)}</span>
          </span>
        </div>
        <DropdownMenuSeparator />
        {startupConfig?.helpAndFaqURL !== '/' && (
          <Menu.MenuItem
            onClick={() => window.open(startupConfig?.helpAndFaqURL, '_blank')}
            className="select-item"
          >
            <LinkIcon aria-hidden="true" />
            {localize('com_nav_help_faq')}
          </Menu.MenuItem>
        )}
        <Menu.MenuItem onClick={openSettings} className="select-item">
          <GearIcon className="icon-md" aria-hidden="true" />
          {localize('com_nav_settings')}
        </Menu.MenuItem>
        {isAdmin && (
          <Menu.MenuItem onClick={() => setShowAdminUsers(true)} className="select-item">
            <Shield className="icon-md" aria-hidden="true" />
            User Management
          </Menu.MenuItem>
        )}
        <DropdownMenuSeparator />
        <Menu.MenuItem onClick={() => logout()} className="select-item">
          <LogOut className="icon-md" aria-hidden="true" />
          {localize('com_nav_log_out')}
        </Menu.MenuItem>
      </Menu.Menu>
      {showAdminUsers && (
        <AdminUsersModal open={showAdminUsers} onOpenChange={setShowAdminUsers} />
      )}
      {showSettings && (
        <Settings
          open={showSettings}
          onOpenChange={(open) => {
            setShowSettings(open);
            if (!open) {
              // One-shot deep link (e.g. bborg plan prompt → Billing): the
              // next manual open should land on the default tab again.
              setSettingsInitialTab(null);
            }
          }}
          initialTab={settingsInitialTab ?? undefined}
        />
      )}
    </Menu.MenuProvider>
  );
}

export default memo(AccountSettings);
