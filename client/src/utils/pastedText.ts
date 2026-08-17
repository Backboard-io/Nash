export interface DetectedPaste {
  /** Human-readable language label, e.g. "JavaScript" or "Text". */
  language: string;
  /** File extension (no dot) to use when representing the paste as a file. */
  ext: string;
  /** True when the content looks like source code rather than prose. */
  isCode: boolean;
}

/** A pasted block large enough to be lifted out of the textarea into a card. */
const MIN_LINES = 8;
const MIN_CHARS = 500;

/** Whether a pasted string is large enough to surface as its own attachment card. */
export function shouldPasteAsFile(text: string): boolean {
  if (!text) {
    return false;
  }
  const lineCount = text.split('\n').length;
  return lineCount >= MIN_LINES || text.length >= MIN_CHARS;
}

/** Line count that ignores a single trailing newline. */
export function countLines(text: string): number {
  if (!text) {
    return 0;
  }
  const normalized = text.replace(/\n$/, '');
  return normalized.length === 0 ? 0 : normalized.split('\n').length;
}

const MAX_TITLE_LEN = 48;

/**
 * A short, human-readable title taken from the START of a pasted block, so the
 * attachment reads like its content ("The quick brown fox…", "def process_order")
 * instead of a generic "Pasted text". Falls back to the generic label when
 * nothing usable is found.
 */
export function derivePastedTitle(text: string, isCode: boolean): string {
  const generic = isCode ? 'Pasted code' : 'Pasted text';
  if (!text) {
    return generic;
  }
  const firstLine = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    return generic;
  }
  const cleaned = firstLine
    // strip a leading comment / list / markdown marker (//, #, /*, *, --, ;, >, -, 1.)
    .replace(/^(\/\/+|#+|\/\*+|\*+|--+|;+|>+|-\s|\d+[.)]\s)\s*/, '')
    // drop backticks only — underscores/asterisks are meaningful in code
    .replace(/`+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) {
    return generic;
  }
  return cleaned.length > MAX_TITLE_LEN
    ? `${cleaned.slice(0, MAX_TITLE_LEN).trimEnd()}…`
    : cleaned;
}

/**
 * A readable name for a file pasted from the clipboard. Keeps the user's real
 * filename when it's descriptive; for a nameless/generic clipboard blob (e.g. a
 * screenshot that arrives as "image.png" or ""), labels it by kind —
 * "Pasted image.png", "Pasted audio.wav" — instead of a raw timestamp.
 */
export function derivePastedFileName(name: string, mimeType: string): string {
  const trimmed = (name || '').trim();
  const ext =
    (trimmed.includes('.') ? trimmed.split('.').pop() : '') ||
    (mimeType || '').split('/')[1]?.split(';')[0] ||
    'file';
  const base = trimmed.replace(/\.[^.]+$/, '').trim();
  const isGeneric =
    !base || /^(image|images|blob|clipboard|unnamed|file|screenshot|pasted)([-_ ]?\d+)?$/i.test(base);
  if (!isGeneric) {
    return trimmed;
  }
  const kind = mimeType?.startsWith('image/')
    ? 'image'
    : mimeType?.startsWith('video/')
      ? 'video'
      : mimeType?.startsWith('audio/')
        ? 'audio'
        : 'file';
  return `Pasted ${kind}.${ext}`;
}

/** Filename-safe version of derivePastedTitle, with an extension. */
export function derivePastedFilename(text: string, isCode: boolean, ext?: string): string {
  const extension = (isCode ? ext : undefined) || 'txt';
  const base = derivePastedTitle(text, isCode)
    .replace(/…$/, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '') // keep letters, numbers, spaces, hyphens
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 40)
    .replace(/^_+|_+$/g, '');
  const fallback = isCode ? 'Pasted_code' : 'Pasted_text';
  return `${base || fallback}.${extension}`;
}

/**
 * Lightweight, dependency-free language sniffing for pasted blocks. Keep this
 * conservative: pasted articles and docs often contain words like "class",
 * "function", "select", bullets, or angle-bracketed labels, but should still be
 * represented as text unless the paste has code-shaped structure.
 */
export function detectPastedLanguage(text: string): DetectedPaste {
  const sample = text.slice(0, 4000);
  const trimmed = sample.trim();
  const lines = sample.split('\n').map((line) => line.trim()).filter(Boolean);
  const lineCount = Math.max(lines.length, 1);
  const hasCodeDensity =
    /[{};]/.test(sample) ||
    lines.filter((line) => /^(import|export|from|def|class|const|let|var|function|if|for|while|return)\b/.test(line)).length >= 2;

  if (/^[[{]/.test(trimmed)) {
    try {
      JSON.parse(text);
      return { language: 'JSON', ext: 'json', isCode: true };
    } catch {
      /* not JSON, keep sniffing */
    }
  }

  const htmlTags = sample.match(/<\/?(html|head|body|main|section|article|div|span|p|a|ul|ol|li|table|tr|td|th|script|style|template|form|input|button|svg|path)\b[^>]*>/gi) ?? [];
  if (/^<!doctype html/i.test(trimmed) || htmlTags.length >= 3) {
    return { language: 'HTML', ext: 'html', isCode: true };
  }

  const pythonScore = [
    /^\s*(def|class)\s+\w+\s*\([^)]*\)\s*:/m,
    /^\s*(from\s+[\w.]+\s+import|import\s+[\w.]+)/m,
    /^\s*(if|elif|else|for|while|try|except|with)\b.*:\s*$/m,
    /^\s{2,}(return|print|self\.|\w+\s=)/m,
  ].filter((pattern) => pattern.test(sample)).length;
  if (pythonScore >= 2 || (pythonScore >= 1 && /^\s{4,}\S/m.test(sample) && hasCodeDensity)) {
    return { language: 'Python', ext: 'py', isCode: true };
  }

  const shellLineCount = lines.filter((line) =>
    /^(\$\s+)?(cd|ls|cat|grep|rg|find|npm|yarn|pnpm|uv|python|pip|git|curl|echo|export|source|make)\b/.test(line),
  ).length;
  if (/^#!.*\b(bash|sh|zsh)\b/.test(trimmed) || shellLineCount >= Math.min(2, lineCount)) {
    return { language: 'Shell', ext: 'sh', isCode: true };
  }

  const sqlLineCount = lines.filter((line) =>
    /^(SELECT\b.+\bFROM\b|INSERT\s+INTO\b|UPDATE\b.+\bSET\b|DELETE\s+FROM\b|CREATE\s+TABLE\b)/i.test(line),
  ).length;
  if (sqlLineCount >= 1 && (/[;\n]/.test(sample) || /\b(WHERE|JOIN|GROUP BY|ORDER BY|VALUES)\b/i.test(sample))) {
    return { language: 'SQL', ext: 'sql', isCode: true };
  }

  const tsScore = [
    /^\s*(interface|type|enum)\s+\w+/m,
    /^\s*(const|let|var)\s+\w+\s*:\s*[\w<>{}[\]|]+\s*=/m,
    /\)\s*:\s*(string|number|boolean|void|Promise<|[\w[\]<>|]+)\s*(=>|\{)/,
    /\b(public|private|protected|readonly)\s+\w+\s*[:(]/,
  ].filter((pattern) => pattern.test(sample)).length;
  if (tsScore >= 1 && hasCodeDensity) {
    return { language: 'TypeScript', ext: 'ts', isCode: true };
  }

  const jsScore = [
    /^\s*(import|export)\s+.+\b(from\s+['"]|function|class|const|let|var)\b/m,
    /^\s*(const|let|var)\s+[$\w]+\s*=\s*/m,
    /^\s*(async\s+)?function\s+[$\w]+\s*\(/m,
    /^\s*class\s+[$\w]+(\s+extends\s+[$\w]+)?\s*\{/m,
    /=>\s*({|\w|async|\()/,
    /\bconsole\.\w+\s*\(/,
    /\brequire\s*\(\s*['"][^'"]+['"]\s*\)/,
  ].filter((pattern) => pattern.test(sample)).length;
  if (jsScore >= 2 || (jsScore >= 1 && hasCodeDensity)) {
    return { language: 'JavaScript', ext: 'js', isCode: true };
  }

  const cssRuleCount = lines.filter((line, index) => {
    if (!/[.#]?[\w-][\w\s.#:[\]="'>+~,-]*\{\s*$/.test(line)) {
      return false;
    }
    if (/^(interface|type|enum|class|function|if|for|while|switch)\b/.test(line)) {
      return false;
    }
    return lines.slice(index + 1, index + 5).some((nextLine) => /^[-\w]+\s*:\s*[^;]+;?$/.test(nextLine));
  }).length;
  if (cssRuleCount >= 1) {
    return { language: 'CSS', ext: 'css', isCode: true };
  }

  if (
    /^#{1,6}\s+\S/m.test(sample) ||
    /^\s*[-*+]\s+\S/m.test(sample) ||
    /\[[^\]]+\]\([^)]+\)/.test(sample)
  ) {
    return { language: 'Markdown', ext: 'md', isCode: false };
  }

  return { language: 'Text', ext: 'txt', isCode: false };
}
