import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRecoilState } from 'recoil';
import * as Ariakit from '@ariakit/react';
import { Bookmark, Users, MoreHorizontal, Database, Library } from 'lucide-react';
import { MCPIcon } from '@librechat/client';
import { PermissionTypes, Permissions } from 'librechat-data-provider';
import { useHasAccess, useLocalize, useShowMarketplace } from '~/hooks';
import { cn } from '~/utils';
import store from '~/store';

type MoreItem = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  /** Route destinations navigate; `panel` items open the LeftControlPanel slide-out. */
  to?: string;
  panel?: string;
  /** Kept out of the mobile drawer, which mirrors the Figma item set. */
  desktopOnly?: boolean;
};

/**
 * Left-nav entry points for the workspace destinations that previously docked
 * in the right side panel. Bookmarks and the Persona marketplace are top-level
 * buttons; the remaining destinations flyout from a small "More" dropdown
 * anchored beside the button.
 */
export default function NavControlLinks({
  isSmallScreen,
  toggleNav,
}: {
  isSmallScreen?: boolean;
  toggleNav: () => void;
}) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const showMarketplace = useShowMarketplace();
  const hasAccessToMemories = useHasAccess({
    permissionType: PermissionTypes.MEMORIES,
    permission: Permissions.USE,
  });
  const hasAccessToReadMemories = useHasAccess({
    permissionType: PermissionTypes.MEMORIES,
    permission: Permissions.READ,
  });
  const hasAccessToCreateMCP = useHasAccess({
    permissionType: PermissionTypes.MCP_SERVERS,
    permission: Permissions.CREATE,
  });

  const [, setOpenControlPanel] = useRecoilState(store.openControlPanel);
  const moreMenu = Ariakit.useMenuStore({ focusLoop: true, placement: 'right-start' });

  const moreItems = useMemo<MoreItem[]>(() => {
    const items: MoreItem[] = [
      {
        id: 'library',
        label: localize('com_ui_library'),
        icon: Library,
        to: '/library',
        desktopOnly: true,
      },
    ];
    if (hasAccessToMemories && hasAccessToReadMemories) {
      items.push({
        id: 'memories',
        label: localize('com_ui_memories'),
        icon: Database,
        to: '/memories',
      });
    }
    if (hasAccessToCreateMCP) {
      // Opens the MCP Builder in the LeftControlPanel slide-out (panel id must
      // match the link registered in useSideNavLinks).
      items.push({
        id: 'mcp-builder',
        label: localize('com_nav_setting_mcp'),
        icon: MCPIcon,
        panel: 'mcp-builder',
      });
    }
    return items;
  }, [localize, hasAccessToMemories, hasAccessToReadMemories, hasAccessToCreateMCP]);

  const handleItem = useCallback(
    (item: MoreItem) => {
      moreMenu.hide();
      if (item.panel != null) {
        setOpenControlPanel(item.panel);
      } else if (item.to != null) {
        navigate(item.to);
      }
      if (isSmallScreen) {
        toggleNav();
      }
    },
    [moreMenu, navigate, setOpenControlPanel, isSmallScreen, toggleNav],
  );

  const handleMarketplace = useCallback(() => {
    navigate('/agents');
    if (isSmallScreen) {
      toggleNav();
    }
  }, [navigate, isSmallScreen, toggleNav]);

  const handleLibrary = useCallback(() => {
    navigate('/bookmarks');
    if (isSmallScreen) {
      toggleNav();
    }
  }, [navigate, isSmallScreen, toggleNav]);

  const rowClass =
    'flex h-[34px] max-md:h-[42px] w-full flex-shrink-0 items-center gap-[11px] max-md:gap-[14px] rounded-[8px] px-[9px] max-md:pl-1 text-[13.5px] leading-[20.25px] max-md:text-[14px] max-md:font-medium max-md:leading-[21px] text-text-primary transition-colors hover:bg-surface-hover dark:text-text-secondary max-md:dark:text-text-primary';

  return (
    <div className="flex flex-col gap-[2px]">
      <button type="button" onClick={handleLibrary} className={rowClass} data-testid="nav-library">
        <Bookmark className="size-4 max-md:size-[18px] flex-shrink-0 text-text-secondary" aria-hidden="true" />
        {localize('com_ui_bookmarks')}
      </button>

      {showMarketplace && (
        <button
          type="button"
          onClick={handleMarketplace}
          className={rowClass}
          data-testid="nav-persona-marketplace"
        >
          <Users className="size-4 max-md:size-[18px] flex-shrink-0 text-text-secondary" aria-hidden="true" />
          {localize('com_agents_marketplace')}
        </button>
      )}

      {isSmallScreen &&
        moreItems
          .filter((item) => !item.desktopOnly)
          .map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleItem(item)}
              className={rowClass}
              data-testid={`nav-${item.id}`}
            >
              <Icon className="size-4 max-md:size-[18px] flex-shrink-0 text-text-secondary" aria-hidden="true" />
              {item.label}
            </button>
          );
        })}

      {!isSmallScreen && moreItems.length > 0 && (
        <Ariakit.MenuProvider store={moreMenu}>
          <Ariakit.MenuButton
            className={rowClass}
            data-testid="nav-tools-toggle"
            aria-label={localize('com_ui_more')}
          >
            <MoreHorizontal className="size-4 flex-shrink-0 text-text-secondary" aria-hidden="true" />
            {localize('com_ui_more')}
          </Ariakit.MenuButton>
          <Ariakit.Menu
            portal={true}
            gutter={8}
            unmountOnHide={true}
            aria-label={localize('com_ui_more')}
            className={cn(
              'z-40 ml-1 flex min-w-[180px] flex-col rounded-xl',
              'border border-border-light bg-presentation p-1.5 shadow-lg',
            )}
          >
            {moreItems.map((item) => {
              const Icon = item.icon;
              return (
                <Ariakit.MenuItem
                  key={item.id}
                  data-testid={`nav-control-${item.id}`}
                  onClick={() => handleItem(item)}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-text-primary outline-none transition-colors hover:bg-surface-hover focus:bg-surface-hover"
                >
                  <Icon className="size-4 text-text-secondary" aria-hidden="true" />
                  {item.label}
                </Ariakit.MenuItem>
              );
            })}
          </Ariakit.Menu>
        </Ariakit.MenuProvider>
      )}
    </div>
  );
}
