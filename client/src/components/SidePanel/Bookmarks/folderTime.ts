/**
 * "3d ago" / "1w ago" — the folder card's Updated stamp.
 *
 * The card is scanned, not read: an age is quicker to judge than a date when
 * the question is "which of these is stale". Anything past a year falls back
 * to a date, where the age stops being meaningful.
 */
export function formatFolderAge(dateStr?: string): string {
  if (dateStr == null || dateStr === '') {
    return '';
  }
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) {
    return 'today';
  }
  if (days === 1) {
    return 'yesterday';
  }
  if (days < 7) {
    return `${days}d ago`;
  }
  if (days < 30) {
    return `${Math.floor(days / 7)}w ago`;
  }
  if (days < 365) {
    return `${Math.floor(days / 30)}mo ago`;
  }
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}
