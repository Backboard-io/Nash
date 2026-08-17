import React, { useMemo } from 'react';
import { Navigate, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, TooltipAnchor, useMediaQuery } from '@librechat/client';
import { QueryKeys } from 'librechat-data-provider';
import type { ContextType } from '~/common';
import { useDocumentTitle, useLocalize } from '~/hooks';
import { SidePanelProvider, useChatContext } from '~/Providers';
import { SidePanelGroup } from '~/components/SidePanel';
import CollapsedNavRail from '~/components/Nav/CollapsedNavRail';
import { FilesContent, type FileTab } from '~/components/Files/FilesView';
import LibraryRail from './LibraryRail';
import { clearMessagesCache } from '~/utils';

type LibrarySection = FileTab;

const DEFAULT_SECTION: LibrarySection = 'all';

function isLibrarySection(value?: string): value is LibrarySection {
  return value === 'all' || value === 'images' || value === 'files';
}

/**
 * Library page. Adopts the Files page layout (single header, "+ New", search + view
 * controls, All / Images / Files filter chips, file table) while keeping the Library
 * name. Bookmarks are reached from the sidebar, not from here — a duplicate section
 * on this page only forked the same data into two places.
 */
export default function LibraryView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { section } = useParams<{ section?: string }>();
  const { conversation, newConversation } = useChatContext();
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const { navVisible, setNavVisible } = useOutletContext<ContextType>();

  const activeSection = isLibrarySection(section) ? section : DEFAULT_SECTION;

  const sectionLabels: Record<LibrarySection, string> = useMemo(
    () => ({
      all: localize('com_ui_all_proper'),
      images: localize('com_ui_images'),
      files: localize('com_ui_files'),
    }),
    [localize],
  );

  useDocumentTitle(`${sectionLabels[activeSection]} | ${localize('com_ui_library')} | Nash`);

  if (section == null || !isLibrarySection(section)) {
    return <Navigate to={`/library/${DEFAULT_SECTION}`} replace />;
  }

  return (
    <div className="relative flex w-full grow overflow-hidden bg-presentation">
      <SidePanelProvider>
        <SidePanelGroup>
          <main className="flex h-full overflow-hidden" role="main">
            <div className="scrollbar-gutter-stable relative flex h-full min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
              {!isSmallScreen && (
                <div className="sticky top-0 z-20 flex items-start justify-between bg-presentation px-2 pt-4 md:min-h-14">
                  <div className="mx-1 flex items-center gap-2">
                    {!navVisible ? (
                      <CollapsedNavRail setNavVisible={setNavVisible} />
                    ) : (
                      <div className="h-8 w-8" />
                    )}
                  </div>
                </div>
              )}

              {/* The same page shell as Bookmarks and the persona marketplace,
                  to the pixel — so the three pages' titles land on the same
                  line when you move between them. This was a centred `max-w-5xl`
                  at `px-4 pb-16 sm:px-6`, which put the header in a different
                  place on every viewport than the other two. */}
              <div className="w-full px-4 pb-[44px] pt-[6px] md:px-[40px] md:pb-[60px] md:pt-[2px]">
                <FilesContent
                  controlledTab={activeSection}
                  onTabChange={(tab) => navigate(`/library/${tab}`)}
                  /* The rail goes *through* FilesContent so it lands beside the
                     table rather than beside the whole column. As a sibling of
                     the scroll container it narrowed the header and search row
                     too, for the full height of the page. */
                  rail={<LibraryRail />}
                  /* Centre column is the Files surface (spec + Figma): title/subtitle/regionLabel
                     all fall back to com_ui_files{,_subtitle}, leaving the rail's <h2> as the only
                     "Library" heading on the page. */
                />
              </div>
            </div>
          </main>
        </SidePanelGroup>
      </SidePanelProvider>
    </div>
  );
}
