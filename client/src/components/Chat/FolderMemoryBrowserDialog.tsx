import { useState, useMemo } from 'react';
import { Trash2, BrainCircuit } from 'lucide-react';
import {
  OGDialog,
  OGDialogContent,
  OGDialogHeader,
  OGDialogTitle,
  Spinner,
  FilterInput,
  useToastContext,
} from '@librechat/client';
import { useFolderMemoriesQuery, useDeleteFolderMemoryMutation } from '~/data-provider';
import type { FolderMemory } from '~/data-provider/Folders/queries';

interface FolderMemoryBrowserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId: string;
  folderName?: string;
}

function MemoryRow({
  memory,
  folderId,
}: {
  memory: FolderMemory;
  folderId: string;
}) {
  const { showToast } = useToastContext();
  const [confirming, setConfirming] = useState(false);
  const { mutate: deleteMemory, isLoading } = useDeleteFolderMemoryMutation(folderId);

  const handleDelete = () => {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
      return;
    }
    deleteMemory(memory.key, {
      onSuccess: () => showToast({ message: 'Memory deleted', status: 'success' }),
      onError: () => showToast({ message: 'Failed to delete memory', status: 'error' }),
    });
  };

  const formattedDate = memory.updated_at
    ? new Date(memory.updated_at).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '';

  return (
    <div className="group rounded-lg border border-border-light bg-transparent px-3 py-2.5 hover:bg-surface-secondary">
      <div className="flex items-center gap-2">
        {memory.tokenCount !== undefined && (
          <span className="shrink-0 text-xs text-text-tertiary">
            {memory.tokenCount} {memory.tokenCount === 1 ? 'token' : 'tokens'}
          </span>
        )}
        {formattedDate && (
          <span className="shrink-0 text-xs text-text-tertiary">{formattedDate}</span>
        )}
        <button
          type="button"
          onClick={handleDelete}
          disabled={isLoading}
          className={`ml-auto flex size-7 shrink-0 items-center justify-center rounded-md opacity-0 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-border-heavy group-hover:opacity-100 ${
            confirming
              ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
              : 'text-text-secondary hover:bg-surface-tertiary hover:text-text-primary'
          }`}
          aria-label={confirming ? 'Click again to confirm delete' : 'Delete memory'}
          title={confirming ? 'Click again to confirm' : 'Delete'}
        >
          {isLoading ? (
            <Spinner className="size-3.5" />
          ) : (
            <Trash2 className="size-3.5" aria-hidden="true" />
          )}
        </button>
      </div>
      <p className="mt-1 min-w-0 text-sm text-text-primary">{memory.value}</p>
    </div>
  );
}

export default function FolderMemoryBrowserDialog({
  open,
  onOpenChange,
  folderId,
  folderName,
}: FolderMemoryBrowserDialogProps) {
  const [search, setSearch] = useState('');
  const { data, isLoading } = useFolderMemoriesQuery(folderId, { enabled: open && !!folderId });

  const filtered = useMemo(() => {
    const memories = data?.memories ?? [];
    if (!search.trim()) return memories;
    const q = search.toLowerCase();
    return memories.filter((m) => m.value.toLowerCase().includes(q));
  }, [data, search]);

  const title = folderName ? `${folderName} — Memories` : 'Folder Memories';

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogContent className="flex w-11/12 max-w-lg flex-col gap-0 p-0 md:max-w-xl" showCloseButton>
        <OGDialogHeader className="border-b border-border-light px-5 py-4">
          <OGDialogTitle className="flex items-center gap-2 text-base font-semibold">
            <BrainCircuit className="size-4 text-text-secondary" aria-hidden="true" />
            {title}
          </OGDialogTitle>
        </OGDialogHeader>

        <div className="flex flex-col gap-3 px-5 py-4">
          <FilterInput
            inputId="folder-memory-search"
            label="Filter memories"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            containerClassName="w-full"
          />

          <div className="max-h-[60vh] overflow-y-auto pr-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Spinner className="size-5 text-text-tertiary" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <BrainCircuit className="mb-3 size-8 text-text-tertiary" aria-hidden="true" />
                <p className="text-sm text-text-secondary">
                  {search.trim()
                    ? 'No memories match your search.'
                    : 'No memories in this folder yet. Import some to get started.'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map((memory) => (
                  <MemoryRow key={memory.key} memory={memory} folderId={folderId} />
                ))}
              </div>
            )}
          </div>

          {!isLoading && data && data.memories.length > 0 && (
            <p className="text-right text-xs text-text-tertiary">
              {filtered.length} of {data.memories.length} {data.memories.length === 1 ? 'memory' : 'memories'}
            </p>
          )}
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}
