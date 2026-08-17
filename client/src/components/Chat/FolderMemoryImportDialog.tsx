import { useState, useCallback } from 'react';
import { Check, Copy, ArrowRight, ArrowLeft } from 'lucide-react';
import {
  OGDialog,
  OGDialogTemplate,
  Button,
  Spinner,
  useToastContext,
} from '@librechat/client';
import type { UseMutateFunction } from '@tanstack/react-query';
import type { CreateFolderMemoryParams, CreateFolderMemoryResponse } from '~/data-provider/Folders/queries';
import { useCreateFolderMemoryMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

const IMPORT_PROMPT = `I'm switching to a new AI assistant and want to bring my context with me.
Please output everything you know about me — my preferences, work context, communication style, projects, tools, and any other relevant details — as a structured list.
Format each item as:
[category_name]: description with relevant context
For example:
[spouse_name]: Cindy is Karl's wife, Cindy and Karl met in 2010
[primary_coding_language]: TypeScript and Python are Karl's primary coding languages
[work_context]: Karl builds AI-powered SaaS products
Be thorough. Include everything you've learned about me across our conversations.
Before you start, ask me two questions: "Is there anything specific or general you want me to leave out?" and "Is there anything you want me to provide extra detail about?"`;

function parseImportedMemories(text: string): CreateFolderMemoryParams[] {
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  const memories: CreateFolderMemoryParams[] = [];
  const seenKeys = new Set<string>();

  for (const line of lines) {
    const bracketMatch = line.match(/^\[([^\]]+)\]:\s*(.+)/);
    if (bracketMatch) {
      const rawKey = bracketMatch[1].trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z_]/g, '');
      const value = bracketMatch[2].trim();
      if (rawKey && value) {
        const key = seenKeys.has(rawKey) ? `${rawKey}_${seenKeys.size}` : rawKey;
        seenKeys.add(key);
        memories.push({ key, value });
      }
      continue;
    }

    const colonMatch = line.match(/^([a-z_][a-z_0-9]*):\s*(.+)/i);
    if (colonMatch) {
      const rawKey = colonMatch[1].trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z_0-9]/g, '');
      const value = colonMatch[2].trim();
      if (rawKey && value) {
        const key = seenKeys.has(rawKey) ? `${rawKey}_${seenKeys.size}` : rawKey;
        seenKeys.add(key);
        memories.push({ key, value });
      }
      continue;
    }

    const bulletMatch = line.match(/^[-•*]\s*\*?\*?([^:*]+)\*?\*?:\s*(.+)/);
    if (bulletMatch) {
      const rawKey = bulletMatch[1].trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z_0-9]/g, '');
      const value = bulletMatch[2].trim();
      if (rawKey && value) {
        const key = seenKeys.has(rawKey) ? `${rawKey}_${seenKeys.size}` : rawKey;
        seenKeys.add(key);
        memories.push({ key, value });
      }
    }
  }

  return memories;
}

interface FolderMemoryImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId: string;
  folderName?: string;
  children?: React.ReactNode;
}

export default function FolderMemoryImportDialog({
  open,
  onOpenChange,
  folderId,
  folderName,
  children,
}: FolderMemoryImportDialogProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [step, setStep] = useState<1 | 2>(1);
  const [copied, setCopied] = useState(false);
  const [pastedText, setPastedText] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });

  const { mutate: createMemory } = useCreateFolderMemoryMutation(folderId, {
    onError: () => { /* handled in bulk flow */ },
  });

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(IMPORT_PROMPT);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const resetState = useCallback(() => {
    setStep(1);
    setCopied(false);
    setPastedText('');
    setIsImporting(false);
    setImportProgress({ done: 0, total: 0 });
  }, []);

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        resetState();
      }
      onOpenChange(isOpen);
    },
    [onOpenChange, resetState],
  );

  const handleImport = useCallback(() => {
    const memories = parseImportedMemories(pastedText);
    if (memories.length === 0) {
      showToast({
        message: localize('com_ui_memory_import_no_memories'),
        status: 'error',
      });
      return;
    }

    setIsImporting(true);
    setImportProgress({ done: 0, total: memories.length });

    let completed = 0;
    let failed = 0;

    const createNext = (
      index: number,
      mutate: UseMutateFunction<CreateFolderMemoryResponse, Error, CreateFolderMemoryParams>,
    ) => {
      if (index >= memories.length) {
        setIsImporting(false);
        const successCount = completed - failed;
        showToast({
          message: localize('com_ui_memory_import_complete', {
            0: String(successCount),
            1: String(memories.length),
          }),
          status: failed > 0 ? 'warning' : 'success',
        });
        handleOpenChange(false);
        return;
      }

      mutate(memories[index], {
        onSuccess: () => {
          completed++;
          setImportProgress({ done: completed, total: memories.length });
          createNext(index + 1, mutate);
        },
        onError: () => {
          completed++;
          failed++;
          setImportProgress({ done: completed, total: memories.length });
          createNext(index + 1, mutate);
        },
      });
    };

    createNext(0, createMemory);
  }, [pastedText, createMemory, showToast, localize, handleOpenChange]);

  const destination = folderName ? `"${folderName}"` : 'this folder';

  const stepOneContent = (
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">
        {localize('com_ui_memory_import_step1_desc')}
      </p>
      <div className="relative">
        <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border-light bg-surface-secondary p-3 text-xs text-text-primary">
          {IMPORT_PROMPT}
        </pre>
        <Button
          variant="outline"
          size="sm"
          className="absolute right-2 top-2 bg-surface-secondary"
          onClick={handleCopy}
          aria-label={localize('com_ui_copy')}
        >
          {copied ? (
            <Check className="size-3.5 text-brand-purple" aria-hidden="true" />
          ) : (
            <Copy className="size-3.5" aria-hidden="true" />
          )}
        </Button>
      </div>
      <p className="text-xs text-text-tertiary">
        Memories will be imported into {destination}.
      </p>
    </div>
  );

  const stepTwoContent = (
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">
        {localize('com_ui_memory_import_step2_desc')}
      </p>
      <textarea
        value={pastedText}
        onChange={(e) => setPastedText(e.target.value)}
        placeholder={localize('com_ui_memory_import_placeholder')}
        className="min-h-[200px] w-full resize-none rounded-lg border border-border-light bg-transparent px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-heavy"
        rows={8}
        disabled={isImporting}
      />
      {isImporting && (
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <Spinner className="size-3.5" />
          <span>
            {localize('com_ui_memory_import_progress', {
              0: String(importProgress.done),
              1: String(importProgress.total),
            })}
          </span>
        </div>
      )}
    </div>
  );

  return (
    <OGDialog open={open} onOpenChange={handleOpenChange}>
      {children}
      <OGDialogTemplate
        title={`Import memories into ${destination}`}
        showCloseButton={false}
        className="w-11/12 md:max-w-lg"
        main={step === 1 ? stepOneContent : stepTwoContent}
        buttons={
          <div className="flex w-full items-center justify-between">
            <div>
              {step === 2 && (
                <Button
                  variant="outline"
                  onClick={() => setStep(1)}
                  disabled={isImporting}
                >
                  <ArrowLeft className="mr-1 size-3.5" aria-hidden="true" />
                  {localize('com_ui_back')}
                </Button>
              )}
            </div>
            <div>
              {step === 1 ? (
                <Button variant="submit" onClick={() => setStep(2)} className="text-white">
                  {localize('com_ui_next')}
                  <ArrowRight className="ml-1 size-3.5" aria-hidden="true" />
                </Button>
              ) : (
                <Button
                  variant="submit"
                  onClick={handleImport}
                  disabled={isImporting || !pastedText.trim()}
                  className="text-white"
                >
                  {isImporting ? (
                    <Spinner className="size-4" />
                  ) : (
                    localize('com_ui_memory_import_action')
                  )}
                </Button>
              )}
            </div>
          </div>
        }
      />
    </OGDialog>
  );
}
