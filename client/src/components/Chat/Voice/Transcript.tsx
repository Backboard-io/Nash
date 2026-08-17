import { memo } from 'react';

type Props = {
  userText: string;
  assistantText: string;
};

/**
 * Two-side transcript shown beneath the orb during a voice conversation.
 * Renders best-effort — empty sides are simply omitted.
 */
function Transcript({ userText, assistantText }: Props) {
  if (!userText && !assistantText) return null;
  return (
    <div className="mt-6 flex w-full max-w-xl flex-col gap-3 text-sm">
      {userText ? (
        <div className="rounded-lg bg-surface-secondary px-4 py-3 text-text-secondary">
          <div className="mb-1 text-xs uppercase tracking-wide text-text-tertiary">You</div>
          <div className="whitespace-pre-wrap">{userText}</div>
        </div>
      ) : null}
      {assistantText ? (
        <div className="rounded-lg bg-surface-tertiary px-4 py-3 text-text-primary">
          <div className="mb-1 text-xs uppercase tracking-wide text-text-tertiary">Nash</div>
          <div className="whitespace-pre-wrap">{assistantText}</div>
        </div>
      ) : null}
    </div>
  );
}

export default memo(Transcript);
