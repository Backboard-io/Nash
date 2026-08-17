import {
  BookmarkIcon,
  ExternalLink,
  ImageIcon,
  MessageSquare,
  StickyNote,
  Table2,
} from 'lucide-react';
import type { TSavedMessage } from 'librechat-data-provider';
import { cn } from '~/utils';
import { readSavedContent } from './savedContent';

/** Chip used for the note and the source chat on a row's meta line. */
function Chip({
  icon,
  children,
  tone = 'default',
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  tone?: 'default' | 'warning';
}) {
  return (
    <span
      className={cn(
        'inline-flex h-[27px] min-w-0 max-w-[320px] items-center gap-[6px] rounded-[8px] px-[9px] text-[12px] leading-[17px]',
        tone === 'warning'
          ? 'bg-surface-warning-subtle text-text-warning'
          : 'bg-surface-hover text-text-secondary',
      )}
    >
      <span className="shrink-0 [&>svg]:h-[11px] [&>svg]:w-[11px]" aria-hidden="true">
        {icon}
      </span>
      <span className="truncate">{children}</span>
    </span>
  );
}

/**
 * One saved response in a folder [I1].
 *
 * 776 × 110, padding 15 / 13, radius 13. Model and timestamp on the top line,
 * a two-line excerpt, then the note and source chat as chips — "your note as a
 * chip, source chat as a chip", because a match in a note is a different thing
 * from a matching response.
 */
export default function BookmarkRow({
  saved,
  isSelected,
  onSelect,
  chatDeleted,
  noteLabel,
  chatLabel,
  deletedLabel,
  untitledLabel,
  timestamp,
  openHintLabel,
  imageLabel,
  imagesLabel,
  tableLabel,
  menu,
}: {
  saved: TSavedMessage;
  isSelected: boolean;
  onSelect: () => void;
  /** [I8] The source conversation is gone — the response is kept, but the
   *  chip turns warning-coloured rather than the row disappearing. */
  chatDeleted?: boolean;
  noteLabel: string;
  chatLabel: string;
  deletedLabel: string;
  /** Stands in when the source chat had no title yet at the moment it was
   *  saved — titles are generated after the first exchange, so bookmarking
   *  early left this blank and the chip read "From:" pointing at nothing. */
  untitledLabel: string;
  timestamp: string;
  /** "Open in chat" — what a click on the row does, said on hover. Optional so
   *  a list whose rows do not navigate simply omits it. */
  openHintLabel?: string;
  imageLabel: string;
  imagesLabel: string;
  tableLabel: string;
  /** The row's ⋯ menu. Omitted where there is nothing to act on. */
  menu?: React.ReactNode;
}) {
  const note = saved.note ?? '';
  const content = readSavedContent(saved.text);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'group flex cursor-pointer flex-col rounded-[13px] px-[15px] py-[13px] transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isSelected ? 'bg-surface-hover' : 'nash-card hover:bg-surface-hover',
      )}
    >
      <div className="flex h-[17px] items-center gap-[8px]">
        <BookmarkIcon
          className="h-[13px] w-[13px] shrink-0 fill-current text-text-tertiary"
          aria-hidden="true"
        />
        <span className="min-w-0 truncate text-[12px] leading-[17px] text-text-secondary">
          {saved.model || saved.endpoint || ''}
        </span>
        <span className="ml-auto shrink-0 text-[12px] leading-[17px] text-text-tertiary">
          {timestamp}
        </span>
        {menu}
      </div>

      {/* Two lines of the response, then it stops. Prose only — the code and
          the images are drawn as themselves below, so the preview is not a line
          of markdown syntax. */}
      {content.text !== '' && (
        /* The preview keeps its emphasis. Flattening it lost the one thing that
           told you which sentence mattered — and a response saved *because* of
           a bolded conclusion previewed as an undifferentiated line. Bold,
           italic and inline code only: they are the marks that still read at
           two lines, and they arrive as elements, never as markup. */
        <p className="mt-[9px] line-clamp-2 text-[13.5px] leading-[22px] text-text-primary">
          {content.inline.map((token, i) => {
            if (token.code === true) {
              return (
                <code
                  key={i}
                  className="rounded-[5px] bg-surface-primary-alt px-[5px] py-[1px] font-mono text-[12.5px]"
                >
                  {token.text}
                </code>
              );
            }
            if (token.bold === true) {
              return (
                <strong key={i} className="font-medium">
                  {token.text}
                </strong>
              );
            }
            if (token.italic === true) {
              return <em key={i}>{token.text}</em>;
            }
            return <span key={i}>{token.text}</span>;
          })}
        </p>
      )}

      {/* §9 `code`: a --sunken card carrying its language. Two lines of it is
          enough to recognise which snippet this is, which is all a row owes
          you — the rest is one click away. */}
      {content.code != null && (
        <div className="mt-[9px] overflow-hidden rounded-[10px] bg-surface-primary-alt px-3 py-[9px]">
          <span className="mb-1 block text-[11px] leading-[16px] text-text-tertiary">
            {content.code.language}
          </span>
          <pre className="line-clamp-2 whitespace-pre-wrap break-all font-mono text-[12px] leading-[18px] text-text-secondary">
            {content.code.body}
          </pre>
        </div>
      )}

      <div className="mt-[10px] flex h-[27px] items-center gap-[7px]">
        {note !== '' && (
          <Chip icon={<StickyNote />}>
            {noteLabel}: {note}
          </Chip>
        )}
        {content.hasTable && (
          /* A table flattened to prose is a row of words with no columns —
             naming it is more use than previewing it. */
          <Chip icon={<Table2 />}>{tableLabel}</Chip>
        )}
        {content.imageCount > 0 && (
          /* The image itself is not fetched here — a row is a list item, not a
             gallery, and these URLs are authenticated downloads. Saying an
             image is in there is the part that was missing; before this the
             row printed the raw `![Dog](/api/files/download/…)`. */
          <Chip icon={<ImageIcon />}>
            {content.imageCount > 1
              ? `${content.imageCount} ${imagesLabel}`
              : (content.imageAlt ?? imageLabel)}
          </Chip>
        )}
        <Chip icon={<MessageSquare />} tone={chatDeleted === true ? 'warning' : 'default'}>
          {chatDeleted === true
            ? deletedLabel
            : `${chatLabel}: ${saved.title != null && saved.title !== '' ? saved.title : untitledLabel}`}
        </Chip>

        {/* What the row does, said rather than implied. The whole card is
            clickable and nothing about a saved response suggests that clicking
            it leaves the page, so the hint names the destination. It sits at
            the free end of the chip row and fades in on hover, so it displaces
            nothing (§10.2) and is silent until you are pointing at the row. */}
        {openHintLabel != null && (
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[12px] leading-[17px] text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <ExternalLink className="h-[13px] w-[13px]" aria-hidden="true" />
          {openHintLabel}
        </span>
        )}
      </div>
    </div>
  );
}
