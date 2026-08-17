import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRecoilState } from 'recoil';
import * as Ariakit from '@ariakit/react';
import { Bookmark, Users, MoreHorizontal, Database, Library } from 'lucide-react';
import { MCPIcon } from '@librechat/client';
import { PermissionTypes, Permissions } from 'librechat-data-provider';
import { useHasAccess, useLocalize, useShowMarketplace } from '~/hooks';
import { cn } from '~/utils';
import './nav.css';
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
      // A page now, not a slide-out: MCP servers carry search, cards, a create
      // dialog and a provider catalogue, which is more than a 300px panel can
      // hold — and every other management surface in the app is a page.
      items.push({
        id: 'mcp-builder',
        label: localize('com_nav_setting_mcp'),
        icon: MCPIcon,
        to: '/mcp',
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
    // Figma nav item: 34 tall, 11 gap, 9 side padding, 12.5px label.
    'flex h-[34px] w-full flex-shrink-0 items-center gap-[11px] rounded-[8px] px-[9px] text-[12.5px] leading-[18.75px] text-text-primary transition-colors hover:bg-surface-hover hover:text-text-primary dark:text-text-secondary';

  return (
    <div className="flex flex-col gap-[2px]">
      <button type="button" onClick={handleLibrary} className={rowClass} data-testid="nav-library">
        <Bookmark className="size-4 flex-shrink-0 text-text-secondary" aria-hidden="true" />
        {localize('com_ui_bookmarks')}
      </button>

      {showMarketplace && (
        <button
          type="button"
          onClick={handleMarketplace}
          className={rowClass}
          data-testid="nav-persona-marketplace"
        >
          <Users className="size-4 flex-shrink-0 text-text-secondary" aria-hidden="true" />
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
              <Icon className="size-4 flex-shrink-0 text-text-secondary" aria-hidden="true" />
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
          {/* Same flyout as the org switcher: elevated fill, no border, 12px
              clear of the panel (24 from the trigger, which the nav insets),
              4px above it, growing out of its left edge. */}
          <Ariakit.Menu
            portal={true}
            modal={false}
            gutter={24}
            shift={-4}
            unmountOnHide={true}
            aria-label={localize('com_ui_more')}
            className={cn(
              'z-[125] flex w-[206px] flex-col rounded-[14px] !border-0 p-1.5',
              'nash-menu',
              'nash-flyout',
            )}
          >
            {moreItems.map((item) => {
              const Icon = item.icon;
              return (
                <Ariakit.MenuItem
                  key={item.id}
                  data-testid={`nav-control-${item.id}`}
                  onClick={() => handleItem(item)}
                  /* --t1 at regular weight. The Figma note said these sit
                     back until hovered, and --t2 delivered that by making the
                     only text in the menu hard to read: a menu row is a thing
                     you are choosing between, not a caption. Weight carries
                     the "sits back", not tone. */
                  className="flex w-full cursor-pointer items-center gap-[10px] rounded-[10px] px-[10px] py-[7px] text-[13px] font-normal text-text-primary outline-none transition-colors hover:bg-surface-active focus:bg-surface-active"
                >
                  <Icon className="size-4 shrink-0 text-text-secondary-alt" aria-hidden="true" />
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
