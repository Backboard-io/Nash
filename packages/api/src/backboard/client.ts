import { logger } from '@librechat/data-schemas';
import type {
  BackboardAssistant,
  BackboardThread,
  BackboardDocument,
  BackboardMemory,
  BackboardMemoriesListResponse,
  BackboardStreamEvent,
  BackboardMemoryOperationStatus,
} from './types';

const DEFAULT_BASE_URL = 'https://app.backboard.io/api';
const DEFAULT_TIMEOUT_MS = 60_000;

export class BackboardClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(apiKey: string, baseUrl = DEFAULT_BASE_URL, timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
  }

  private headers(): Record<string, string> {
    return {
      'X-API-Key': this.apiKey,
      'User-Agent': 'librechat-backboard/1.0',
    };
  }

  private async request<T>(
    method: string,
    endpoint: string,
    options?: {
      json?: Record<string, unknown>;
      formData?: Record<string, string>;
      params?: Record<string, string | number>;
    },
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/${endpoint.replace(/^\//, '')}`);
    if (options?.params) {
      for (const [key, val] of Object.entries(options.params)) {
        url.searchParams.set(key, String(val));
      }
    }

    const headers: Record<string, string> = { ...this.headers() };
    let body: string | FormData | undefined;

    if (options?.json) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.json);
    } else if (options?.formData) {
      const fd = new FormData();
      for (const [key, val] of Object.entries(options.formData)) {
        fd.append(key, val);
      }
      body = fd as unknown as string;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url.toString(), {
        method,
        headers: options?.formData ? this.headers() : headers,
        body,
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '<no body>');
        throw new Error(`Backboard API ${res.status}: ${text}`);
      }

      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async *streamMessage(
    threadId: string,
    content: string,
    options?: {
      llmProvider?: string;
      modelName?: string;
      memory?: string;
      webSearch?: string;
    },
  ): AsyncGenerator<BackboardStreamEvent> {
    const url = new URL(`${this.baseUrl}/threads/${threadId}/messages`);
    const formData = new FormData();
    formData.append('content', content);
    formData.append('stream', 'true');

    if (options?.llmProvider) {
      formData.append('llm_provider', options.llmProvider);
    }
    if (options?.modelName) {
      formData.append('model_name', options.modelName);
    }
    if (options?.memory) {
      formData.append('memory', options.memory);
    }
    if (options?.webSearch) {
      formData.append('web_search', options.webSearch);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs * 3);

    try {
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: this.headers(),
        body: formData,
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '<no body>');
        throw new Error(`Backboard streaming ${res.status}: ${text}`);
      }

      if (!res.body) {
        throw new Error('No response body for streaming');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) {
            continue;
          }
          try {
            const payload = JSON.parse(trimmed.slice(6)) as BackboardStreamEvent;
            if (payload.type === 'error' || payload.type === 'run_failed') {
              throw new Error(payload.error ?? payload.message ?? 'Streaming error');
            }
            yield payload;
          } catch (e) {
            if (e instanceof SyntaxError) {
              continue;
            }
            throw e;
          }
        }
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async createAssistant(name: string, description?: string): Promise<BackboardAssistant> {
    const data: Record<string, unknown> = { name };
    if (description) {
      data.description = description;
    }
    return this.request<BackboardAssistant>('POST', '/assistants', { json: data });
  }

  async listAssistants(skip = 0, limit = 100): Promise<BackboardAssistant[]> {
    return this.request<BackboardAssistant[]>('GET', '/assistants', {
      params: { skip, limit },
    });
  }

  async getAssistant(assistantId: string): Promise<BackboardAssistant> {
    return this.request<BackboardAssistant>('GET', `/assistants/${assistantId}`);
  }

  /**
   * @deprecated Assistants must never be deleted — they hold threads, documents, and memories.
   * This method is intentionally a no-op to prevent accidental data loss.
   */
  async deleteAssistant(_assistantId: string): Promise<Record<string, unknown>> {
    logger.warn('[BackboardClient] deleteAssistant called but is a no-op — assistants must never be deleted');
    return {};
  }

  async createThread(assistantId: string): Promise<BackboardThread> {
    return this.request<BackboardThread>('POST', `/assistants/${assistantId}/threads`, {
      json: {},
    });
  }

  async listThreads(skip = 0, limit = 100): Promise<BackboardThread[]> {
    return this.request<BackboardThread[]>('GET', '/threads', {
      params: { skip, limit },
    });
  }

  async getThread(threadId: string): Promise<BackboardThread> {
    return this.request<BackboardThread>('GET', `/threads/${threadId}`);
  }

  async deleteThread(threadId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('DELETE', `/threads/${threadId}`);
  }

  async addMemory(
    assistantId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const data: Record<string, unknown> = { content };
    if (metadata) {
      data.metadata = metadata;
    }
    return this.request<Record<string, unknown>>('POST', `/assistants/${assistantId}/memories`, {
      json: data,
    });
  }

  async getMemories(assistantId: string): Promise<BackboardMemoriesListResponse> {
    return this.request<BackboardMemoriesListResponse>(
      'GET',
      `/assistants/${assistantId}/memories`,
    );
  }

  async deleteMemory(
    assistantId: string,
    memoryId: string,
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      'DELETE',
      `/assistants/${assistantId}/memories/${memoryId}`,
    );
  }

  async uploadDocumentToAssistant(
    assistantId: string,
    filename: string,
    fileBuffer: Buffer,
  ): Promise<BackboardDocument> {
    const url = new URL(`${this.baseUrl}/assistants/${assistantId}/documents`);
    const formData = new FormData();
    formData.append('file', new Blob([fileBuffer]), filename);

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: this.headers(),
      body: formData,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '<no body>');
      throw new Error(`Backboard upload ${res.status}: ${text}`);
    }

    return (await res.json()) as BackboardDocument;
  }

  async uploadDocumentToThread(
    threadId: string,
    filename: string,
    fileBuffer: Buffer,
  ): Promise<BackboardDocument> {
    const url = new URL(`${this.baseUrl}/threads/${threadId}/documents`);
    const formData = new FormData();
    formData.append('file', new Blob([fileBuffer]), filename);

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: this.headers(),
      body: formData,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '<no body>');
      throw new Error(`Backboard upload ${res.status}: ${text}`);
    }

    return (await res.json()) as BackboardDocument;
  }

  async listAssistantDocuments(assistantId: string): Promise<BackboardDocument[]> {
    return this.request<BackboardDocument[]>('GET', `/assistants/${assistantId}/documents`);
  }

  async listThreadDocuments(threadId: string): Promise<BackboardDocument[]> {
    return this.request<BackboardDocument[]>('GET', `/threads/${threadId}/documents`);
  }

  async deleteDocument(documentId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('DELETE', `/documents/${documentId}`);
  }

  async getDocumentStatus(documentId: string): Promise<BackboardDocument> {
    return this.request<BackboardDocument>('GET', `/documents/${documentId}/status`);
  }

  async waitForDocumentIndexed(
    documentId: string,
    timeoutMs = 120_000,
    pollIntervalMs = 2_000,
  ): Promise<BackboardDocument> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const doc = await this.getDocumentStatus(documentId);
      if (doc.status === 'indexed') {
        return doc;
      }
      if (doc.status === 'failed') {
        throw new Error(`Document indexing failed: ${doc.status_message ?? 'unknown error'}`);
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    throw new Error(`Document indexing timed out after ${timeoutMs / 1000}s`);
  }

  async getMemoryOperationStatus(operationId: string): Promise<BackboardMemoryOperationStatus> {
    return this.request<BackboardMemoryOperationStatus>(
      'GET',
      `/assistants/memories/operations/${operationId}`,
    );
  }

  /** Polls until the memory operation reaches COMPLETED or FAILED, or timeout. */
  async waitForMemoryOperation(
    operationId: string,
    timeoutMs = 30_000,
    pollIntervalMs = 1_000,
  ): Promise<BackboardMemoryOperationStatus | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const status = await this.getMemoryOperationStatus(operationId);
        if (status.status === 'COMPLETED' || status.status === 'FAILED') {
          return status;
        }
      } catch {
        /* transient errors are retried */
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    return null;
  }
}
