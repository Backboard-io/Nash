import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { useLocalize } from '~/hooks';
import { liquid } from '~/utils/motion';

const CLAMP_LINES = 7;

/**
 * DESIGN.md §9 — a message you sent clamps at seven lines, fades out, and
 * carries a Show more / Show less toggle with a rotating chevron. Replies never
 * clamp.
 *
 * The cut-off is measured from the element's real `lineHeight` rather than a
 * character count, so it lands on line 7 at any font size and on any width —
 * the same text wraps differently on a phone. A message short enough to fit
 * gets no toggle at all.
 */
export default function ClampedMessage({ children }: { children: React.ReactNode }) {
  const localize = useLocalize();
  const reduceMotion = useReducedMotion();
  const contentRef = useRef<HTMLDivElement>(null);
  const [cap, setCap] = useState<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const measure = useCallback(() => {
    const el = contentRef.current;
    if (el == null) {
      return;
    }
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
      return;
    }
    const limit = lineHeight * CLAMP_LINES;
    /* Half a line of slack: a message that overflows by a rounding error is not
     * long enough to be worth a toggle. */
    setCap(el.scrollHeight > limit + lineHeight / 2 ? limit : null);
  }, []);

  useLayoutEffect(measure, [measure, children]);

  useEffect(() => {
    const el = contentRef.current;
    if (el == null || typeof ResizeObserver === 'undefined') {
      return;
    }
    /* Re-measure on width changes — the same text is 6 lines on a desktop and
     * 11 on a phone, and the toggle has to appear and disappear with that. */
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  const isClamped = cap != null && !isExpanded;

  return (
    <div className="flex flex-col">
      {/* §10 rule 1: animate to `auto`, never to a guessed pixel height. Open
          leaves the element sized by its content, so anything that grows after
          the fact — an image finishing its load — is not cut off. */}
      <motion.div
        className="relative overflow-hidden"
        initial={false}
        animate={{ height: isClamped ? cap : 'auto' }}
        transition={
          reduceMotion === true
            ? { duration: 0.001 }
            : liquid
        }
      >
        <div ref={contentRef}>{children}</div>
        {isClamped && (
          /* The fade sits on the bubble's own fill so the text dissolves into
           * it rather than into a grey band. */
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-transparent to-surface-chat" />
        )}
      </motion.div>
      {cap != null && (
        <button
          type="button"
          onClick={() => setIsExpanded((open) => !open)}
          className="mt-1.5 flex items-center gap-1 self-start text-[12.5px] font-medium text-text-secondary-alt transition-colors hover:text-text-primary"
        >
          {isExpanded ? localize('com_ui_show_less') : localize('com_ui_show_more')}
          <ChevronDown
            size={13}
            aria-hidden="true"
            className={`transition-transform duration-[260ms] ${isExpanded ? 'rotate-180' : ''}`}
          />
        </button>
      )}
    </div>
  );
}
