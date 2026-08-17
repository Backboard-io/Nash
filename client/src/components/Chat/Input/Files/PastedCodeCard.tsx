import { memo, useState } from 'react';
import { Code2, ChevronDown, FileText, X } from 'lucide-react';
import type { PastedBlock } from '~/store/families';
import { countLines, derivePastedTitle } from '~/utils/pastedText';
import { cn } from '~/utils';

/**
 * Composer card for a large pasted block (NASH "Chat Box Code Input"). Collapsed
 * by default to just the header; expands to reveal the raw content. The block is
 * injected into the outgoing message on submit (see useSubmitMessage).
 */
function PastedCodeCard({ block, onRemove }: { block: PastedBlock; onRemove: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const lines = countLines(block.text);
  const label = derivePastedTitle(block.text, block.isCode);
  const meta = `${block.language} · ${lines} ${lines === 1 ? 'line' : 'lines'}`;
  const Icon = block.isCode ? Code2 : FileText;

  return (
    <div className="group relative w-72 max-w-full overflow-hidden rounded-2xl border border-border-light bg-surface-hover-alt text-sm text-text-primary">
      <div className="flex items-center gap-2 p-2">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-purple/10 text-text-accent">
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="truncate font-medium">{label}</div>
          <div className="truncate text-text-secondary">{meta}</div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          aria-expanded={expanded}
          className="rounded-lg p-1 text-text-secondary transition-colors hover:bg-surface-hover"
        >
          <ChevronDown
            className={cn('size-4 transition-transform', expanded && 'rotate-180')}
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove"
          className="rounded-lg p-1 text-text-secondary transition-colors hover:bg-surface-hover"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      {expanded && (
        <pre className="max-h-56 overflow-auto border-t border-border-light bg-surface-secondary px-3 py-2 text-xs leading-relaxed text-text-secondary">
          <code className="whitespace-pre font-mono">{block.text}</code>
        </pre>
      )}
    </div>
  );
}

export default memo(PastedCodeCard);
