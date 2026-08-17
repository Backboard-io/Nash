import { useState, memo, useRef } from 'react';
import { useRecoilState } from 'recoil';
import * as Menu from '@ariakit/react/menu';
import { LogOut, Shield } from 'lucide-react';
import { SystemRoles } from 'librechat-data-provider';
import { LinkIcon, GearIcon, DropdownMenuSeparator, Avatar } from '@librechat/client';
import { useGetStartupConfig } from '~/data-provider';
import { useAuthContext } from '~/hooks/AuthContext';
import AdminUsersModal from './AdminUsersModal';
import Settings from './Settings';
import { useLocalize } from '~/hooks';
import store from '~/store';

function AccountSettings({ onNavigate }: { onNavigate?: () => void }) {
  const localize = useLocalize();
  const { user, logout } = useAuthContext();
  const { data: startupConfig } = useGetStartupConfig();
  const [showSettings, setShowSettings] = useRecoilState(store.showSettings);
  const [showAdminUsers, setShowAdminUsers] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const accountSettingsButtonRef = useRef<HTMLButtonElement>(null);

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
    <Menu.MenuProvider open={isMenuOpen} setOpen={setIsMenuOpen}>
      <Menu.MenuButton
        ref={accountSettingsButtonRef}
        aria-label={localize('com_nav_account_settings')}
        data-testid="nav-user"
        className="flex h-12 w-full flex-shrink-0 items-center gap-2.5 rounded-[9px] px-[9px] transition-colors duration-200 ease-in-out hover:bg-surface-hover aria-[expanded=true]:bg-surface-active"
      >
        <div className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#E7E8EA] dark:bg-surface-active">
          {(user?.avatar ?? '') !== '' ? (
            <Avatar user={user} size={30} />
          ) : (
            <span
              className="text-[13px] font-medium leading-[19.5px] text-text-secondary-alt dark:text-text-primary"
              aria-hidden="true"
            >
              {displayName.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <div className="flex min-w-0 grow flex-col gap-px text-left">
          <span className="truncate text-[13px] font-medium leading-[19.5px] text-text-primary">
            {displayName}
          </span>
          {(user?.email ?? '') !== '' && (
            <span className="truncate text-[11px] leading-[16.5px] text-text-secondary-alt">
              {user?.email}
            </span>
          )}
        </div>
        <GearIcon className="h-3.5 w-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
      </Menu.MenuButton>
      <Menu.Menu
        className="account-settings-popover popover-ui z-[125] w-[305px] rounded-lg md:w-[244px]"
        style={{
          transformOrigin: 'bottom',
          translate: '0 -4px',
        }}
      >
        <div className="text-token-text-secondary ml-3 mr-2 py-2 text-sm" role="note">
          {isApiKeyUser
            ? user?.name || localize('com_nav_api_user')
            : (user?.email ?? localize('com_nav_user'))}
        </div>
        <DropdownMenuSeparator />
        {startupConfig?.helpAndFaqURL !== '/' && (
          <Menu.MenuItem
            onClick={() => window.open(startupConfig?.helpAndFaqURL, '_blank')}
            className="select-item text-sm"
          >
            <LinkIcon aria-hidden="true" />
            {localize('com_nav_help_faq')}
          </Menu.MenuItem>
        )}
        <Menu.MenuItem onClick={openSettings} className="select-item text-sm">
          <GearIcon className="icon-md" aria-hidden="true" />
          {localize('com_nav_settings')}
        </Menu.MenuItem>
        {isAdmin && (
          <Menu.MenuItem onClick={() => setShowAdminUsers(true)} className="select-item text-sm">
            <Shield className="icon-md text-blue-500" aria-hidden="true" />
            User Management
          </Menu.MenuItem>
        )}
        <DropdownMenuSeparator />
        <Menu.MenuItem onClick={() => logout()} className="select-item text-sm">
          <LogOut className="icon-md" aria-hidden="true" />
          {localize('com_nav_log_out')}
        </Menu.MenuItem>
      </Menu.Menu>
      {showAdminUsers && (
        <AdminUsersModal open={showAdminUsers} onOpenChange={setShowAdminUsers} />
      )}
      {showSettings && <Settings open={showSettings} onOpenChange={setShowSettings} />}
    </Menu.MenuProvider>
  );
}

export default memo(AccountSettings);
