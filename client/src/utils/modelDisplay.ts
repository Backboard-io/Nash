/**
 * Display-only formatting of raw model ids. `formatModelName` must never be
 * used to build payload values, storage keys, or comparisons — the raw model
 * id remains the value sent to the backend everywhere.
 *
 * Examples:
 * - "anthropic/claude-opus-5" -> "claude opus 5"
 * - "meta-llama/llama-3.1-8b-instruct:free" -> "llama 3.1 8b instruct"
 */
export function formatModelName(modelId?: string | null): string {
  if (modelId == null) {
    return '';
  }
  const slug = String(modelId).trim().split('/').pop() ?? '';
  return slug
    .split(/[:@]/)[0]
    .replace(/[-_]+/g, ' ')
    .trim();
}

export default formatModelName;
