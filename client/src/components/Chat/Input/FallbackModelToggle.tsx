import React, { memo, useCallback } from 'react';
import { Zap } from 'lucide-react';
import { useRecoilState } from 'recoil';
import { Constants } from 'librechat-data-provider';
import { TooltipAnchor } from '@librechat/client';
import { useBadgeRowContext } from '~/Providers';
import { ephemeralAgentByConvoId } from '~/store';
import { cn } from '~/utils';

const FALLBACK_LABEL = 'GPT-4.1 Fallback';
const FALLBACK_TOOLTIP =
  'If the selected model fails, automatically retry your message with GPT-4.1 and note the switch in the response.';

function FallbackModelToggle() {
  const { conversationId } = useBadgeRowContext();
  const [ephemeralAgent, setEphemeralAgent] = useRecoilState(
    ephemeralAgentByConvoId(conversationId ?? Constants.NEW_CONVO),
  );

  /**
   * Default to enabled when the key is absent — the backend fallback is opt-out,
   * not opt-in, so users who never touch this still get the safety net.
   */
  const isEnabled: boolean = (ephemeralAgent as Record<string, unknown>)?.fallback_model !== false;

  const handleToggle = useCallback(() => {
    setEphemeralAgent((prev) => ({
      ...(prev ?? {}),
      fallback_model: !isEnabled,
    }));
  }, [isEnabled, setEphemeralAgent]);

  return (
    <TooltipAnchor
      description={FALLBACK_TOOLTIP}
      render={
        <button
          type="button"
          role="switch"
          aria-checked={isEnabled}
          aria-label={`${FALLBACK_LABEL}: ${isEnabled ? 'on' : 'off'}`}
          onClick={handleToggle}
          className={cn(
            'group flex h-9 items-center gap-1.5 rounded-full border px-2.5',
            'text-xs font-medium transition-all duration-200',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50',
            isEnabled
              ? [
                  'border-amber-500/40 bg-amber-500/10 text-amber-700',
                  'hover:border-amber-500/60 hover:bg-amber-500/20',
                  'dark:text-amber-300 dark:hover:bg-amber-500/25',
                ]
              : [
                  'border-border-light bg-transparent text-text-tertiary',
                  'hover:bg-surface-hover hover:text-text-secondary',
                ],
          )}
        />
      }
    >
      <Zap
        aria-hidden="true"
        className={cn(
          'h-3.5 w-3.5 shrink-0 transition-all duration-200',
          isEnabled
            ? 'fill-amber-500/50 stroke-amber-600 dark:fill-amber-400/40 dark:stroke-amber-300'
            : 'fill-none stroke-current',
          'group-active:scale-90',
        )}
      />
      <span className="select-none leading-none">Fallback</span>
    </TooltipAnchor>
  );
}

export default memo(FallbackModelToggle);
