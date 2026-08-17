const PENDING_CHAT_STORAGE_KEY = 'nash.pending-chat';

export type PendingChatDraft = {
  text: string;
  autoSend: boolean;
  conversation?: Record<string, unknown> | null;
  addedConversation?: Record<string, unknown> | null;
  savedAt: number;
};

const isBrowser = typeof window !== 'undefined';

function getStorage(): Storage | null {
  if (!isBrowser) {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toPendingChatDraft(value: unknown): PendingChatDraft | null {
  if (!isRecord(value)) {
    return null;
  }

  const text = typeof value.text === 'string' ? value.text : null;
  if (text == null) {
    return null;
  }

  return {
    text,
    autoSend: value.autoSend === true,
    conversation: isRecord(value.conversation) ? value.conversation : null,
    addedConversation: isRecord(value.addedConversation) ? value.addedConversation : null,
    savedAt: typeof value.savedAt === 'number' ? value.savedAt : Date.now(),
  };
}

export function savePendingChatDraft(draft: PendingChatDraft): void {
  const storage = getStorage();
  if (storage == null) {
    return;
  }

  try {
    storage.setItem(PENDING_CHAT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Ignore storage failures.
  }
}

export function readPendingChatDraft(): PendingChatDraft | null {
  const storage = getStorage();
  if (storage == null) {
    return null;
  }

  try {
    const raw = storage.getItem(PENDING_CHAT_STORAGE_KEY);
    if (raw == null) {
      return null;
    }

    return toPendingChatDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearPendingChatDraft(): void {
  const storage = getStorage();
  if (storage == null) {
    return;
  }

  try {
    storage.removeItem(PENDING_CHAT_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export function hasPendingChatDraft(): boolean {
  return readPendingChatDraft() != null;
}
