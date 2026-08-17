import { useState, useCallback, useMemo, memo } from 'react';
import throttle from 'lodash/throttle';
import { ResizablePanel, ResizablePanelGroup, useMediaQuery } from '@librechat/client';
import ArtifactsPanel from './ArtifactsPanel';
import LeftControlPanel from './LeftControlPanel';
import { normalizeLayout } from '~/utils';

interface SidePanelProps {
  artifacts?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Hosts the main chat/marketplace content alongside the artifacts panel and the
 * left controls slide-out ({@link LeftControlPanel}). The right-docked controls
 * panel was removed in favour of the left slide-out, so this group now only
 * splits between the main view and artifacts; the slide-out floats over the
 * content area and is driven by the global `openControlPanel` atom.
 */
const SidePanelGroup = memo(({ artifacts, children }: SidePanelProps) => {
  const [shouldRenderArtifacts, setShouldRenderArtifacts] = useState(artifacts != null);
  const isSmallScreen = useMediaQuery('(max-width: 767px)');

  const calculateLayout = useCallback(() => {
    if (artifacts == null) {
      return [100];
    }
    const mainSize = Math.floor(100 / 2);
    return [mainSize, 100 - mainSize];
  }, [artifacts]);

  const currentLayout = useMemo(() => normalizeLayout(calculateLayout()), [calculateLayout]);

  const throttledSaveLayout = useMemo(
    () =>
      throttle((sizes: number[]) => {
        const normalizedSizes = normalizeLayout(sizes);
        localStorage.setItem('react-resizable-panels:layout', JSON.stringify(normalizedSizes));
      }, 350),
    [],
  );

  const minSizeMain = useMemo(() => (artifacts != null ? 15 : 30), [artifacts]);

  return (
    <>
      <div className="relative flex h-full w-full flex-1 overflow-hidden">
        <ResizablePanelGroup
          direction="horizontal"
          onLayout={(sizes) => throttledSaveLayout(sizes)}
          className="relative h-full w-full flex-1 overflow-auto bg-presentation"
        >
          <ResizablePanel
            defaultSize={currentLayout[0]}
            minSize={minSizeMain}
            order={1}
            id="messages-view"
          >
            {children}
          </ResizablePanel>

          {!isSmallScreen && (
            <ArtifactsPanel
              artifacts={artifacts}
              currentLayout={currentLayout}
              minSizeMain={minSizeMain}
              shouldRender={shouldRenderArtifacts}
              onRenderChange={setShouldRenderArtifacts}
            />
          )}
        </ResizablePanelGroup>
        <LeftControlPanel />
      </div>
      {artifacts != null && isSmallScreen && (
        <div className="fixed inset-0 z-[100]">{artifacts}</div>
      )}
    </>
  );
});

SidePanelGroup.displayName = 'SidePanelGroup';

export default SidePanelGroup;
