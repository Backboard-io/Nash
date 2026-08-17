/**
 * A chat title as the sidebar shows it: **the first three words**, then an
 * ellipsis if there were more.
 *
 * CSS `text-overflow: ellipsis` alone cut wherever the row happened to run out
 * of room, which lands mid-word — "The following is the earlier c…" — and gives
 * every row a different amount of text depending on how wide its characters
 * are. Three words is the same promise on every row, and it breaks where
 * language does.
 *
 * The full title still goes on `title`/`aria-label`, so nothing is lost: this
 * is a display cut, not a rename. `truncate` stays on the element as a
 * backstop for three words that are themselves too long for the row.
 */
export const CHAT_TITLE_WORDS = 3;

export function truncateChatTitle(title: string, words = CHAT_TITLE_WORDS): string {
  const parts = title.trim().split(/\s+/);
  if (parts.length <= words) {
    return title;
  }
  return `${parts.slice(0, words).join(' ')}…`;
}
