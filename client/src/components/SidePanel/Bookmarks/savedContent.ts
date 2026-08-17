/**
 * What a saved response is made of.
 *
 * A bookmark row shows a two-line preview of `text`, which is markdown. Printed
 * raw, a saved code block reads as ```` ```html <!DOCTYPE html> ```` running
 * into the prose, and a saved image reads as `![Dog](/api/files/download/…)` —
 * the two kinds you are most likely to keep are the two that look worst.
 *
 * So the text is read once and split into what it holds: the prose, the first
 * code block, and how many images. The row renders each in the shape §9 gives
 * it rather than as a line of syntax.
 */

const FENCE = /```([\w+-]*)\n?([\s\S]*?)```/;
const TABLE_ROW = /^\s*\|.*\|\s*$/m;
const LIST_ITEM = /^\s*(?:[-*+]|\d+\.)\s+/m;
const IMAGE = /!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g;
const LINK = /\[([^\]]*)\]\([^)]*\)/g;
const INLINE_MARK = /(\*\*|__|\*|`|#{1,6}\s)/g;

/** A run of preview text and how it was marked up. */
export type InlineToken = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
};

export type SavedContent = {
  /** Prose with the code, images and markdown syntax taken out. */
  text: string;
  code?: { language: string; body: string };
  /** The prose again, but keeping the emphasis rather than flattening it. */
  inline: InlineToken[];
  /** Images referenced by the response — counted, not loaded. */
  imageCount: number;
  imageAlt?: string;
  /** Structure that does not survive being squashed onto two lines. */
  hasTable: boolean;
  hasList: boolean;
};

/**
 * Split a line of markdown into styled runs.
 *
 * Only the three marks that carry meaning in a two-line preview: bold, italic
 * and inline code. Headings become bold, since their size would not read at
 * this scale anyway. Everything else was already removed upstream, so there is
 * no nesting to handle and no HTML to sanitise — these become React elements,
 * never markup.
 */
export function readInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const pattern = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3|`([^`]+)`/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) != null) {
    if (match.index > last) {
      tokens.push({ text: text.slice(last, match.index) });
    }
    if (match[2] != null) {
      tokens.push({ text: match[2], bold: true });
    } else if (match[4] != null) {
      tokens.push({ text: match[4], italic: true });
    } else if (match[5] != null) {
      tokens.push({ text: match[5], code: true });
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) {
    tokens.push({ text: text.slice(last) });
  }
  return tokens.filter((t) => t.text !== '');
}

export function readSavedContent(raw?: string): SavedContent {
  const source = raw ?? '';

  const fence = FENCE.exec(source);
  const code =
    fence != null
      ? { language: fence[1] !== '' ? fence[1] : 'code', body: fence[2].trim() }
      : undefined;

  const images = [...source.matchAll(IMAGE)];

  const text = source
    .replace(FENCE, ' ')
    .replace(IMAGE, ' ')
    /* A link keeps its words and loses its URL — the words are the part worth
     * previewing, and a download URL is most of the line. */
    .replace(LINK, '$1')
    /* A heading's hashes go but its words stay, promoted to bold — the size
       that made it a heading means nothing on one line. */
    .replace(/^#{1,6}\s+(.*)$/gm, '**$1**')
    /* A bullet keeps a bullet. Flattened to prose, a list otherwise runs its
       items together into one unreadable sentence. */
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '• ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    text,
    inline: readInline(text),
    code,
    imageCount: images.length,
    imageAlt: images[0]?.[1] !== '' ? images[0]?.[1] : undefined,
    hasTable: TABLE_ROW.test(source),
    hasList: LIST_ITEM.test(source),
  };
}

/**
 * What kinds of thing a saved response holds.
 *
 * The filter strip is built from these rather than from a fixed list: a pill
 * only exists when something behind it does. That is what keeps the strip
 * honest — Artifacts, Tools and Prompts are real kinds in the wider product but
 * nothing can save one yet, so their pills simply never appear rather than
 * sitting there returning nothing.
 */
export type SavedKind = 'response' | 'code' | 'image' | 'file' | 'table';

const FILE_LINK = /\]\((?:[^)]*\/api\/files\/download\/[^)\s]+|[^)\s]+\.(?:pdf|zip|csv|docx?|xlsx?|pptx?|txt|json|md))/i;

export function savedKinds(raw?: string): Set<SavedKind> {
  const content = readSavedContent(raw);
  const kinds = new Set<SavedKind>();

  if (content.code != null) {
    kinds.add('code');
  }
  if (content.imageCount > 0) {
    kinds.add('image');
  }
  if (content.hasTable) {
    kinds.add('table');
  }
  if (FILE_LINK.test(raw ?? '')) {
    kinds.add('file');
  }
  /* Prose counts as a response only when there is prose — a saved snippet that
   * is nothing but a code block should not also answer to "Responses". */
  if (content.text !== '') {
    kinds.add('response');
  }
  return kinds;
}
