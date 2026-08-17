/**
 * Display-only formatting of raw model ids. `formatModelName` must never be
 * used to build payload values, storage keys, or comparisons — the raw model
 * id remains the value sent to the backend everywhere.
 *
 *   anthropic/claude-opus-4-5      -> Claude Opus 4.5
 *   claude-3-5-sonnet-20241022     -> Claude 3.5 Sonnet
 *   gpt-4o-latest                  -> GPT 4o
 *
 * Vendor prefix, release stamp and channel suffix all go: they identify a
 * build, and a label says which model answered, not which build. Dashes become
 * spaces, and a run of bare numbers rejoins on a dot so a version stays one
 * number rather than reading as two.
 */

/** Tokens whose brand casing isn't plain Title Case — "Gpt" is not a word. */
const CASED: Record<string, string> = {
  gpt: 'GPT', ai: 'AI', llm: 'LLM', tts: 'TTS', stt: 'STT', xl: 'XL', hd: 'HD', ocr: 'OCR',
  vl: 'VL', glm: 'GLM', qwq: 'QwQ', moe: 'MoE', chatgpt: 'ChatGPT', deepseek: 'DeepSeek', minimax: 'MiniMax',
};

/** Build stamps and channel suffixes carried by raw model ids. */
const NOISE = /^(latest|preview|beta|stable|turbo|exp|free)$/i;

export function formatModelName(modelId?: string | null): string {
  if (modelId == null || modelId === '') {
    return '';
  }

  const name = (String(modelId).trim().split('/').pop() ?? '').split(/[:@]/)[0];
  const tokens = name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .filter((token) => !/^\d{6,8}$|^0\d{3}$/.test(token))
    .filter((token) => !NOISE.test(token));

  const merged: string[] = [];
  for (const token of tokens) {
    const previous = merged[merged.length - 1];
    if (/^\d+$/.test(token) && previous != null && /^[\d.]+$/.test(previous)) {
      merged[merged.length - 1] = `${previous}.${token}`;
    } else {
      merged.push(token);
    }
  }

  return merged
    .map((token) => {
      const cased = CASED[token.toLowerCase()];
      if (cased != null) {
        return cased;
      }
      if (/^o\d+$/i.test(token)) {
        return token.toLowerCase();
      }
      if (/^(\d+x)?\d+b$/i.test(token) || /^[a-z]\d+b$/i.test(token)) {
        return token.toUpperCase().replace('X', 'x');
      }
      return token.charAt(0).toUpperCase() + token.slice(1);
    })
    .join(' ');
}

export default formatModelName;
