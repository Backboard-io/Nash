import { useEffect, useMemo, useState } from 'react';
import { X, Folder, ChevronDown, Check } from 'lucide-react';
import * as Ariakit from '@ariakit/react';
import { Spinner, useToastContext } from '@librechat/client';
import type { TSavedMessage } from 'librechat-data-provider';
import {
  useSavedMessageFoldersQuery,
  useSaveMessageMutation,
  useUpdateSavedMessageMutation,
  useCreateSavedMessageFolderMutation,
} from '~/data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/** Sentinel for the implicit bucket — `folderId: null` on the wire. */
const UNSORTED = '__unsorted__';

type SaveToBookmarksDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Source conversation title — stored on the saved row and shown on its card. */
  title?: string;
  /** The action button this panel hangs off (Figma C2 anchors it to the message). */
  anchorRef?: React.RefObject<HTMLElement>;
  messageId: string;
  conversationId: string;
  /** Full response text; the excerpt block clamps it to two lines. */
  text: string;
  model?: string;
  endpoint?: string;
  /** Present when this response is already bookmarked — switches to edit mode. */
  existing?: TSavedMessage;
  /**
   * Fired after a successful save with the resolved folder display name. `created` is false when
   * this was an edit of an existing bookmark — the caller must not offer "Undo" then, since undo
   * deletes the row rather than restoring the previous note.
   */
  onSaved: (folderName: string, meta: { created: boolean }) => void;
};

/** Figma C2 / C4 — 360x323, gap 16, pad 16/18/18/18, fill surface-hover, 1px border-heavy, r16. */
export default function SaveToBookmarksDialog({
  open,
  onOpenChange,
  anchorRef,
  title,
  messageId,
  conversationId,
  text,
  model,
  endpoint,
  existing,
  onSaved,
}: SaveToBookmarksDialogProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const isEditing = existing != null;

  /** Every write path surfaces the same failure toast; the dialog stays open so it can be retried. */
  const showSaveError = () =>
    showToast({ message: localize('com_ui_bookmark_save_error'), status: 'error' });

  const [note, setNote] = useState('');
  const [selected, setSelected] = useState<string>(UNSORTED);
  const [isCreating, setIsCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const { data: folders = [] } = useSavedMessageFoldersQuery({ enabled: open });
  /** The list route appends a virtual "unsorted" row; we render our own, so drop it. */
  const realFolders = useMemo(() => folders.filter((folder) => folder.virtual !== true), [folders]);

  /** Reset to the current server state every time the dialog is reopened. */
  useEffect(() => {
    if (!open) {
      return;
    }
    setNote(existing?.note ?? '');
    setSelected(existing?.folderId ?? UNSORTED);
    setIsCreating(false);
    setNewFolderName('');
  }, [open, existing]);

  const selectedName = useMemo(() => {
    if (selected === UNSORTED) {
      return localize('com_ui_unsorted');
    }
    return realFolders.find((folder) => folder.folderId === selected)?.name ?? localize('com_ui_unsorted');
  }, [selected, realFolders, localize]);

  const createFolder = useCreateSavedMessageFolderMutation({
    onSuccess: (folder) => {
      setSelected(folder.folderId);
      setIsCreating(false);
      setNewFolderName('');
    },
    onError: showSaveError,
  });

  const finish = (created: boolean) => () => {
    onOpenChange(false);
    onSaved(selectedName, { created });
  };

  const saveMessage = useSaveMessageMutation({ onSuccess: finish(true), onError: showSaveError });
  const updateSaved = useUpdateSavedMessageMutation({
    onSuccess: finish(false),
    onError: showSaveError,
  });

  const isBusy = saveMessage.isLoading || updateSaved.isLoading;
  const folderId = selected === UNSORTED ? null : selected;

  const handleSubmit = () => {
    if (isBusy) {
      return;
    }
    if (isEditing) {
      updateSaved.mutate({ messageId, note, folderId });
      return;
    }
    saveMessage.mutate({ messageId, conversationId, text, title, note, folderId, model, endpoint });
  };

  const handleCreateFolder = () => {
    const name = newFolderName.trim();
    if (name.length === 0 || createFolder.isLoading) {
      return;
    }
    createFolder.mutate({ name });
  };

  return (
    /* An anchored popover, not a dialog: Figma C2 shows a 360-wide panel sitting
       just under the message's action row with the conversation still visible
       around it — no dimmed backdrop, no centring. */
    <Ariakit.PopoverProvider open={open} setOpen={onOpenChange} placement="bottom-start">
      <Ariakit.Popover
        portal
        gutter={8}
        shift={-8}
        unmountOnHide
        getAnchorRect={() => anchorRef?.current?.getBoundingClientRect() ?? null}
        aria-label={localize('com_ui_save_to_bookmarks')}
        className="z-50 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-4 rounded-2xl border border-border-heavy bg-surface-hover px-[18px] pb-[18px] pt-4 shadow-[0_12px_34px_rgba(0,0,0,0.35)]"
      >
        {/* Header — 324x25 */}
        <div className="flex h-[25px] items-center">
          <Ariakit.PopoverHeading className="text-[14.5px] font-medium leading-[21.8px] text-text-primary">
            {isEditing ? localize('com_ui_saved_to_bookmarks') : localize('com_ui_save_to_bookmarks')}
          </Ariakit.PopoverHeading>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label={localize('com_ui_close')}
            className="flex size-[25px] items-center justify-center rounded-[7px] text-text-secondary-alt transition-colors hover:bg-surface-chat hover:text-text-primary"
          >
            <X size={15} />
          </button>
        </div>

        {/* Excerpt — 324x40, left rule, two clamped lines */}
        <div className="border-l border-border-heavy pl-3">
          <p className="line-clamp-2 text-[12.5px] leading-[19.8px] text-text-secondary-alt">
            {text}
          </p>
        </div>

        {/* Note — 324x74 */}
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={localize('com_ui_add_a_note')}
          aria-label={localize('com_ui_add_a_note')}
          className="h-[74px] w-full resize-none rounded-[10px] bg-surface-chat px-[13px] py-3 text-[13px] leading-[20.5px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-border-heavy"
        />

        {/* Folder select — 324x42 */}
        {isCreating ? (
          <div className="flex h-[42px] items-center gap-2.5 rounded-[10px] bg-surface-chat py-[11px] pl-[13px] pr-3">
            <Folder size={15} className="shrink-0 text-text-secondary" />
            <input
              autoFocus
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleCreateFolder();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  setIsCreating(false);
                }
              }}
              placeholder={localize('com_ui_new_folder_name')}
              aria-label={localize('com_ui_new_folder_name')}
              className="min-w-0 flex-1 bg-transparent text-[13px] leading-[19.5px] text-text-primary placeholder:text-text-tertiary focus:outline-none"
            />
            <button
              type="button"
              onClick={handleCreateFolder}
              disabled={newFolderName.trim().length === 0 || createFolder.isLoading}
              aria-label={localize('com_ui_create')}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-secondary-alt transition-colors hover:text-text-primary disabled:opacity-40"
            >
              {createFolder.isLoading ? <Spinner className="size-4" /> : <Check size={14} />}
            </button>
          </div>
        ) : (
          <div className="relative flex h-[42px] items-center gap-2.5 rounded-[10px] bg-surface-chat py-[11px] pl-[13px] pr-3">
            <Folder size={15} className="shrink-0 text-text-secondary" />
            <span className="min-w-0 flex-1 truncate text-[13px] leading-[19.5px] text-text-primary">
              {selectedName}
            </span>
            <ChevronDown size={14} className="shrink-0 text-text-secondary-alt" />
            <select
              value={selected}
              aria-label={localize('com_ui_folder')}
              onChange={(event) => {
                if (event.target.value === '__new__') {
                  setIsCreating(true);
                  return;
                }
                setSelected(event.target.value);
              }}
              className="absolute inset-0 size-full cursor-pointer opacity-0"
            >
              <option value={UNSORTED}>{localize('com_ui_unsorted')}</option>
              {realFolders.map((folder) => (
                <option key={folder.folderId} value={folder.folderId}>
                  {folder.name}
                </option>
              ))}
              <option value="__new__">{localize('com_ui_new_folder')}</option>
            </select>
          </div>
        )}

        {/* Save — 324x44 */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isBusy}
          className={cn(
            'flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-brand-purple',
            'text-[13px] font-medium leading-[19.5px] text-brand-purple-foreground',
            'transition-colors hover:bg-brand-purple-hover disabled:opacity-60',
          )}
        >
          {isBusy && <Spinner className="size-4" />}
          {isEditing ? localize('com_ui_update') : localize('com_ui_save')}
        </button>
      </Ariakit.Popover>
    </Ariakit.PopoverProvider>
  );
}
