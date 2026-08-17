import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '@librechat/data-schemas';
import { BackboardClient } from './client';
import { getUserAssistantId, getUserApiKey } from './userStore';
import { getSubscriptionBB } from './subscriptionBB';

const PROJECT_ROOT = process.cwd();
import type { Request, Response } from 'express';
import type {
  BackboardDocument,
  BackboardMemory,
  OpenAIContentPart,
  OpenAIChatMessage,
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionResponse,
} from './types';

let cachedClient: BackboardClient | null = null;

function getClient(): BackboardClient {
  if (cachedClient) {
    return cachedClient;
  }

  const apiKey = process.env.BACKBOARD_API_KEY;
  if (!apiKey) {
    throw new Error('BACKBOARD_API_KEY environment variable is required');
  }

  const baseUrl = process.env.BACKBOARD_BASE_URL ?? 'https://app.backboard.io/api';
  cachedClient = new BackboardClient(apiKey, baseUrl);
  return cachedClient;
}

async function getUserClient(userId: string | null): Promise<BackboardClient> {
  if (!userId) {
    return getClient();
  }
  const userApiKey = await getUserApiKey(userId);
  if (!userApiKey) {
    return getClient();
  }
  const baseUrl = process.env.BACKBOARD_BASE_URL ?? 'https://app.backboard.io/api';
  return new BackboardClient(userApiKey, baseUrl);
}

const THREAD_MAP_TYPE = 'thread_mapping';

/** In-memory cache; warm-loaded from Backboard on first miss per assistant. */
const threadMap = new Map<string, string>();
const loadedAssistants = new Set<string>();

async function loadThreadMappings(
  client: BackboardClient,
  assistantId: string,
): Promise<void> {
  if (loadedAssistants.has(assistantId)) {
    return;
  }
  try {
    const response = await client.getMemories(assistantId);
    for (const m of response.memories) {
      const meta = (m.metadata ?? {}) as Record<string, unknown>;
      if (meta.type !== THREAD_MAP_TYPE) {
        continue;
      }
      const cid = meta.conversationId as string | undefined;
      const tid = meta.threadId as string | undefined;
      if (cid && tid && !threadMap.has(cid)) {
        threadMap.set(cid, tid);
      }
    }
    loadedAssistants.add(assistantId);
    logger.info(`[Backboard Proxy] Loaded thread mappings for assistant ${assistantId}`);
  } catch (err) {
    logger.warn(`[Backboard Proxy] Failed to load thread mappings: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function persistThreadMapping(
  client: BackboardClient,
  assistantId: string,
  conversationId: string,
  threadId: string,
): void {
  client.addMemory(assistantId, `${conversationId}→${threadId}`, {
    type: THREAD_MAP_TYPE,
    conversationId,
    threadId,
  }).catch((err: unknown) => {
    logger.warn(`[Backboard Proxy] Failed to persist thread mapping: ${err instanceof Error ? err.message : String(err)}`);
  });
}

async function getOrCreateThread(
  client: BackboardClient,
  assistantId: string,
  conversationId?: string,
): Promise<{ threadId: string; isNew: boolean }> {
  await loadThreadMappings(client, assistantId);

  if (conversationId) {
    const existing = threadMap.get(conversationId);
    if (existing) {
      return { threadId: existing, isNew: false };
    }
  }

  const thread = await client.createThread(assistantId);
  const threadId = thread.thread_id;

  if (conversationId) {
    threadMap.set(conversationId, threadId);
    persistThreadMapping(client, assistantId, conversationId, threadId);
  }

  return { threadId, isNew: true };
}

function extractTextContent(content: string | OpenAIContentPart[] | null): string {
  if (content == null) {
    return '';
  }
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return String(content);
  }
  return content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}


function buildFirstMessagePrompt(
  messages: OpenAIChatMessage[],
  identityPrefix: string,
  folderContext: string,
): string {
  const systemMessages = messages.filter((m) => m.role === 'system');
  const conversationMessages = messages.filter((m) => m.role !== 'system');

  const parts: string[] = [identityPrefix.trim()];

  if (systemMessages.length > 0) {
    const systemContent = systemMessages
      .map((m) => extractTextContent(m.content))
      .filter(Boolean)
      .join('\n');
    if (systemContent) {
      parts.push(`[System Instructions]\n${systemContent}`);
    }
  }

  if (folderContext) {
    parts.push(`[Folder Context — prior conversations in this folder]\n${folderContext}`);
  }

  if (conversationMessages.length > 1) {
    const history = conversationMessages.slice(0, -1);
    const historyLines = history
      .map((m) => {
        const label = m.role === 'user' ? 'User' : 'Assistant';
        return `${label}: ${extractTextContent(m.content)}`;
      })
      .join('\n');
    parts.push(`[Conversation History]\n${historyLines}`);
  }

  const lastMessage = conversationMessages[conversationMessages.length - 1];
  if (lastMessage) {
    parts.push(`[Current Message]\n${extractTextContent(lastMessage.content)}`);
  }

  return parts.join('\n\n');
}

function parseModelSpec(model: string): { provider?: string; modelName: string } {
  if (model.includes('/')) {
    const [provider, ...rest] = model.split('/');
    return { provider, modelName: rest.join('/') };
  }
  return { modelName: model };
}

function readNonEmptyHeader(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const FOLDER_CONTEXT_TYPE = 'folder_thread_context';
const MAX_FOLDER_CONTEXT_CHARS = 8000;

async function fetchFolderContext(
  client: BackboardClient,
  assistantId: string,
): Promise<string> {
  try {
    const response = await client.getMemories(assistantId);
    const contextMemories = response.memories.filter((m: BackboardMemory) => {
      const meta = (m.metadata ?? {}) as Record<string, unknown>;
      return meta.type === FOLDER_CONTEXT_TYPE;
    });

    if (contextMemories.length === 0) {
      return '';
    }

    contextMemories.sort((a: BackboardMemory, b: BackboardMemory) => {
      const aTime = a.created_at ?? '';
      const bTime = b.created_at ?? '';
      return aTime.localeCompare(bTime);
    });

    let totalChars = 0;
    const selected: string[] = [];
    for (let i = contextMemories.length - 1; i >= 0; i--) {
      const content = contextMemories[i].content;
      if (totalChars + content.length > MAX_FOLDER_CONTEXT_CHARS) {
        break;
      }
      selected.unshift(content);
      totalChars += content.length;
    }

    return selected.join('\n---\n');
  } catch (err) {
    logger.warn('[Backboard Proxy] Failed to fetch folder context:', err);
    return '';
  }
}

function saveFolderContext(
  client: BackboardClient,
  assistantId: string,
  userPrompt: string,
  assistantResponse: string,
): void {
  const trimmedPrompt = userPrompt.length > 1000 ? userPrompt.slice(0, 1000) + '…' : userPrompt;
  const trimmedResponse = assistantResponse.length > 1000
    ? assistantResponse.slice(0, 1000) + '…'
    : assistantResponse;

  const content = `User: ${trimmedPrompt}\nAssistant: ${trimmedResponse}`;

  client.addMemory(assistantId, content, {
    type: FOLDER_CONTEXT_TYPE,
    savedAt: new Date().toISOString(),
  }).catch((err: unknown) => {
    logger.warn('[Backboard Proxy] Failed to save folder context:', err);
  });
}

const DOC_INDEX_TIMEOUT_MS = 120_000;
const DOC_POLL_INTERVAL_MS = 2_000;
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

async function uploadAndIndexDocuments(
  res: Response,
  client: BackboardClient,
  threadId: string,
  files: Array<{ filename: string; buffer: Buffer }>,
): Promise<void> {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const completionId = `chatcmpl-bb-${uuidv4().slice(0, 12)}`;
  const created = Math.floor(Date.now() / 1000);

  const writeChunk = (content: string) => {
    const chunk: OpenAIChatCompletionChunk = {
      id: completionId,
      object: 'chat.completion.chunk',
      created,
      model: 'system',
      choices: [{ index: 0, delta: { content }, finish_reason: null }],
    };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  };

  const roleChunk: OpenAIChatCompletionChunk = {
    id: completionId,
    object: 'chat.completion.chunk',
    created,
    model: 'system',
    choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
  };
  res.write(`data: ${JSON.stringify(roleChunk)}\n\n`);

  const fileNames = files.map((f) => f.filename).join(', ');
  writeChunk(`📄 Uploading ${files.length > 1 ? `${files.length} documents` : fileNames}...\n`);

  const uploadedDocs: BackboardDocument[] = [];
  for (const file of files) {
    try {
      const doc = await client.uploadDocumentToThread(threadId, file.filename, file.buffer);
      uploadedDocs.push(doc);
      logger.info(`[Backboard Proxy] Uploaded ${file.filename} → doc ${doc.document_id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[Backboard Proxy] Upload failed for ${file.filename}: ${msg}`);
      writeChunk(`\n❌ Failed to upload ${file.filename}: ${msg}\n`);
    }
  }

  if (uploadedDocs.length === 0) {
    writeChunk('\n⚠️ No documents were uploaded successfully. Proceeding without document context.\n\n');
    return;
  }

  writeChunk('📊 Indexing');

  const start = Date.now();
  let spinnerIdx = 0;
  const pending = new Set(uploadedDocs.map((d) => d.document_id));

  while (pending.size > 0 && Date.now() - start < DOC_INDEX_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, DOC_POLL_INTERVAL_MS));

    for (const docId of [...pending]) {
      try {
        const status = await client.getDocumentStatus(docId);
        if (status.status === 'indexed') {
          pending.delete(docId);
          logger.info(`[Backboard Proxy] Document ${docId} indexed`);
        } else if (status.status === 'failed') {
          pending.delete(docId);
          logger.warn(`[Backboard Proxy] Document ${docId} failed: ${status.status_message ?? 'unknown'}`);
        }
      } catch {
        /* transient errors are retried */
      }
    }

    if (pending.size > 0) {
      const frame = SPINNER_FRAMES[spinnerIdx % SPINNER_FRAMES.length];
      writeChunk(`\r${frame} Indexing (${uploadedDocs.length - pending.size}/${uploadedDocs.length})`);
      spinnerIdx++;
    }
  }

  if (pending.size > 0) {
    writeChunk(`\n⚠️ ${pending.size} document(s) still processing — answers may not include all file content.\n\n`);
    logger.warn(`[Backboard Proxy] ${pending.size} doc(s) not indexed within timeout`);
  } else {
    writeChunk(`\n✅ ${uploadedDocs.length === 1 ? 'Document' : `All ${uploadedDocs.length} documents`} indexed.\n\n`);
  }
}

async function uploadAndIndexDocumentsQuiet(
  client: BackboardClient,
  threadId: string,
  files: Array<{ filename: string; buffer: Buffer }>,
): Promise<void> {
  const uploadedDocs: BackboardDocument[] = [];
  for (const file of files) {
    try {
      const doc = await client.uploadDocumentToThread(threadId, file.filename, file.buffer);
      uploadedDocs.push(doc);
    } catch (err) {
      logger.error(`[Backboard Proxy] Upload failed for ${file.filename}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (uploadedDocs.length === 0) {
    return;
  }

  const start = Date.now();
  const pending = new Set(uploadedDocs.map((d) => d.document_id));

  while (pending.size > 0 && Date.now() - start < DOC_INDEX_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, DOC_POLL_INTERVAL_MS));
    for (const docId of [...pending]) {
      try {
        const status = await client.getDocumentStatus(docId);
        if (status.status === 'indexed' || status.status === 'failed') {
          pending.delete(docId);
        }
      } catch {
        /* retry */
      }
    }
  }

  logger.info(`[Backboard Proxy] Non-streaming doc upload: ${uploadedDocs.length - pending.size}/${uploadedDocs.length} indexed`);
}

export async function handleChatCompletions(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as OpenAIChatCompletionRequest & { tools?: unknown[] };
    const { messages, model, stream, tools } = body;

    if (!messages || messages.length === 0) {
      res.status(400).json({ error: { message: 'messages array is required', type: 'invalid_request_error' } });
      return;
    }

    const hasWebSearchTool = Array.isArray(tools) && tools.some(
      (t) => {
        const tool = t as Record<string, unknown>;
        const fn = tool?.function as Record<string, unknown> | undefined;
        return fn?.name === 'web_search' || tool?.type === 'web_search';
      },
    );

    const resolvedModel = model ?? 'gpt-4o';
    const { provider, modelName } = parseModelSpec(resolvedModel);

    const rawOverrideAssistantId = req.headers['x-backboard-assistant-id'];
    const rawUserId = req.headers['x-backboard-user-id'];
    const rawConversationId = req.headers['x-backboard-conversation-id'];
    const rawWebSearchHeader = req.headers['x-backboard-web-search'];
    const rawUserApiKey = req.headers['x-backboard-user-api-key'];

    const overrideAssistantId = readNonEmptyHeader(rawOverrideAssistantId);
    const userId = readNonEmptyHeader(rawUserId);
    const userApiKey = readNonEmptyHeader(rawUserApiKey);
    const conversationId = readNonEmptyHeader(rawConversationId) ?? undefined;
    const webSearchHeader = readNonEmptyHeader(rawWebSearchHeader) ?? undefined;
    const webSearchMode = hasWebSearchTool || webSearchHeader === 'Auto' ? 'Auto' : undefined;
    logger.info(
      `[Backboard Proxy] model="${model ?? '(none)'}" → provider="${provider ?? '(none)'}", model="${modelName}"${!model ? ' (FALLBACK)' : ''}${webSearchMode ? ' [web_search]' : ''}`,
    );

    if (rawUserId != null && userId == null) {
      res.status(400).json({ error: 'x-backboard-user-id must be a non-empty string' });
      return;
    }
    if (rawOverrideAssistantId != null && overrideAssistantId == null) {
      res.status(400).json({ error: 'x-backboard-assistant-id must be a non-empty string' });
      return;
    }
    if (rawConversationId != null && conversationId == null) {
      res.status(400).json({ error: 'x-backboard-conversation-id must be a non-empty string' });
      return;
    }

    if (!userId && !overrideAssistantId) {
      logger.error('[Backboard Proxy] Rejecting request: no x-backboard-user-id header');
      res.status(400).json({ error: 'Missing user identity — cannot route to assistant' });
      return;
    }

    const client = userApiKey
      ? new BackboardClient(userApiKey, process.env.BACKBOARD_BASE_URL ?? 'https://app.backboard.io/api')
      : await getUserClient(userId);
    const assistantId = overrideAssistantId
      ? overrideAssistantId
      : await getUserAssistantId(userId as string);
    const { threadId, isNew } = await getOrCreateThread(client, assistantId, conversationId);

    const isFolderChat = !!overrideAssistantId;
    const memoryHeader = req.headers['x-backboard-memory'] as string | undefined;
    let memoryMode = 'Auto';
    if (isFolderChat) {
      memoryMode = 'Off';
    } else if (userId) {
      const sub = await getSubscriptionBB(userId);
      if (sub.plan === 'free') {
        memoryMode = 'Off';
      } else if (memoryHeader && ['Auto', 'Readonly', 'Off'].includes(memoryHeader)) {
        memoryMode = memoryHeader;
      }
    }

    const appName = process.env.APP_TITLE ?? 'Nash';
    const userName = req.headers['x-backboard-user-name'] as string | undefined;

    let identityPrefix = `[System] You are ${appName}, an AI assistant. Never refer to yourself as LibreChat. Your name is ${appName}.`;
    if (userName) {
      identityPrefix += ` The user's name is ${userName}.`;
    }

    const lastUserMessage = messages.filter((m) => m.role === 'user').pop();

    const files: Array<{ filename: string; buffer: Buffer }> = [];
    const filesHeader = req.headers['x-backboard-files'] as string | undefined;
    if (filesHeader) {
      try {
        const fileMeta = JSON.parse(filesHeader) as Array<{ filepath: string; filename: string }>;
        for (const meta of fileMeta) {
          try {
            const relativePath = meta.filepath.replace(/^\//, '');
            const absPath = path.resolve(PROJECT_ROOT, relativePath);
            if (fs.existsSync(absPath)) {
              files.push({ filename: meta.filename, buffer: fs.readFileSync(absPath) });
              logger.info(`[Backboard Proxy] Read file from disk: ${meta.filename} (${absPath})`);
            } else {
              logger.warn(`[Backboard Proxy] File not found on disk: ${absPath}`);
            }
          } catch (err) {
            logger.warn(`[Backboard Proxy] Failed to read file ${meta.filepath}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      } catch {
        logger.warn('[Backboard Proxy] Failed to parse x-backboard-files header');
      }
    }

    if (files.length > 0 && stream) {
      await uploadAndIndexDocuments(res, client, threadId, files);
    } else if (files.length > 0) {
      await uploadAndIndexDocumentsQuiet(client, threadId, files);
    }

    let prompt: string;
    if (isNew) {
      let folderContext = '';
      if (overrideAssistantId) {
        folderContext = await fetchFolderContext(client, overrideAssistantId);
        if (folderContext) {
          logger.info(`[Backboard Proxy] Injected ${folderContext.length} chars of folder context`);
        }
      }
      prompt = buildFirstMessagePrompt(messages, identityPrefix, folderContext);
    } else {
      prompt = lastUserMessage ? extractTextContent(lastUserMessage.content) : '';
    }

    const onComplete = isFolderChat
      ? (response: string) => {
        const userText = lastUserMessage ? extractTextContent(lastUserMessage.content) : '';
        saveFolderContext(client, overrideAssistantId, userText, response);
      }
      : undefined;

    logger.info(
      `[Backboard Proxy] ${isNew ? 'new' : 'reused'} thread ${threadId}, convo=${conversationId ?? 'none'}, assistant=${assistantId}${isFolderChat ? ' (folder)' : ''}, memory=${memoryMode}, ${messages.length} msgs, stream=${String(stream)}${files.length > 0 ? `, files=${files.length}` : ''}`,
    );

    const runRequest = async (tid: string, p: string, wsMode?: string) => {
      if (stream) {
        await handleStreamingResponse(res, client, tid, p, modelName, provider, onComplete, memoryMode, wsMode);
      } else {
        await handleNonStreamingResponse(res, client, tid, p, resolvedModel, modelName, provider, onComplete, memoryMode, wsMode);
      }
    };

    try {
      await runRequest(threadId, prompt, webSearchMode);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      const isToolUseError = webSearchMode && (
        msg.includes('tool use') || msg.includes('No endpoints found') || msg.includes('does not support tools')
      );
      if (isToolUseError) {
        logger.warn(`[Backboard Proxy] Model does not support tools, retrying without web_search`);
        try {
          await runRequest(threadId, prompt, undefined);
          return;
        } catch (retryErr) {
          const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          if (!retryMsg.includes('context_length')) {
            throw retryErr;
          }
        }
      }

      const isContextError = msg.includes('context_length') || msg.includes('reduce the length');
      if (isContextError && !isNew) {
        logger.warn(`[Backboard Proxy] Context length exceeded on reused thread, retrying with fresh thread`);
        const freshThread = await client.createThread(assistantId);
        const freshPrompt = buildFirstMessagePrompt(messages, identityPrefix, '');
        await runRequest(freshThread.thread_id, freshPrompt, webSearchMode);
        return;
      }

      if (msg.includes('model_not_found') || msg.includes('does not exist')) {
        const friendly = `This model is currently unavailable. Please select a different model.`;
        logger.warn(`[Backboard Proxy] Model not found: ${msg}`);
        if (!res.headersSent) {
          res.status(404).json({ error: { message: friendly, type: 'model_not_found' } });
        }
        return;
      }

      throw err;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logger.error(`[Backboard Proxy] Error: ${message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: { message, type: 'server_error' } });
    }
  }
}

/** Milliseconds of silence after last content token before closing client stream */
const STREAM_IDLE_TIMEOUT_MS = 1500;

async function handleStreamingResponse(
  res: Response,
  client: BackboardClient,
  threadId: string,
  prompt: string,
  modelName: string,
  provider?: string,
  onComplete?: (response: string) => void,
  memoryMode: string = 'Auto',
  webSearchMode?: string,
): Promise<void> {
  const headersAlreadySent = res.headersSent;

  if (!headersAlreadySent) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
  }

  const completionId = `chatcmpl-bb-${uuidv4().slice(0, 12)}`;
  const created = Math.floor(Date.now() / 1000);

  if (!headersAlreadySent) {
    const roleChunk: OpenAIChatCompletionChunk = {
      id: completionId,
      object: 'chat.completion.chunk',
      created,
      model: modelName,
      choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
    };
    res.write(`data: ${JSON.stringify(roleChunk)}\n\n`);
  }

  const responseParts: string[] = [];
  let streamClosed = false;
  let memoryOperationId: string | undefined;

  const closeClientStream = () => {
    if (streamClosed || res.writableEnded) {
      return;
    }
    streamClosed = true;
    const stopChunk: OpenAIChatCompletionChunk = {
      id: completionId,
      object: 'chat.completion.chunk',
      created,
      model: modelName,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    };
    res.write(`data: ${JSON.stringify(stopChunk)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  };

  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  for await (const event of client.streamMessage(threadId, prompt, {
    llmProvider: provider,
    modelName,
    memory: memoryMode,
    webSearch: webSearchMode,
  })) {
    if (event.type === 'content_streaming' && event.content) {
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      responseParts.push(event.content);
      if (!streamClosed) {
        const chunk: OpenAIChatCompletionChunk = {
          id: completionId,
          object: 'chat.completion.chunk',
          created,
          model: modelName,
          choices: [{ index: 0, delta: { content: event.content }, finish_reason: null }],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      idleTimer = setTimeout(closeClientStream, STREAM_IDLE_TIMEOUT_MS);
    } else if (event.type === 'run_ended') {
      if (event.memory_operation_id) {
        memoryOperationId = event.memory_operation_id;
      }
      logger.info(`[Backboard Proxy] run_ended: memory_op=${event.memory_operation_id ?? 'none'}`);
    }
  }

  if (idleTimer) {
    clearTimeout(idleTimer);
  }
  closeClientStream();

  if (onComplete) {
    onComplete(responseParts.join(''));
  }

  if (memoryOperationId) {
    logger.info(`[Backboard Proxy] Awaiting memory operation ${memoryOperationId}...`);
    const result = await client.waitForMemoryOperation(memoryOperationId).catch((err) => {
      logger.warn(`[Backboard Proxy] Memory operation poll failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    });
    logger.info(`[Backboard Proxy] Memory operation ${memoryOperationId} → ${result?.status ?? 'timeout'}`);
  }
}

async function handleNonStreamingResponse(
  res: Response,
  client: BackboardClient,
  threadId: string,
  prompt: string,
  model: string,
  modelName: string,
  provider?: string,
  onComplete?: (response: string) => void,
  memoryMode: string = 'Auto',
  webSearchMode?: string,
): Promise<void> {
  const contentParts: string[] = [];
  let responseSent = false;
  let memoryOperationId: string | undefined;

  const sendResponse = () => {
    if (responseSent) {
      return;
    }
    responseSent = true;
    const fullResponse = contentParts.join('');
    const response: OpenAIChatCompletionResponse = {
      id: `chatcmpl-bb-${uuidv4().slice(0, 12)}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: model ?? modelName,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: fullResponse },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
    res.json(response);
  };

  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  for await (const event of client.streamMessage(threadId, prompt, {
    llmProvider: provider,
    modelName,
    memory: memoryMode,
    webSearch: webSearchMode,
  })) {
    if (event.type === 'content_streaming' && event.content) {
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      contentParts.push(event.content);
      idleTimer = setTimeout(sendResponse, STREAM_IDLE_TIMEOUT_MS);
    } else if (event.type === 'run_ended') {
      if (event.memory_operation_id) {
        memoryOperationId = event.memory_operation_id;
      }
      logger.info(`[Backboard Proxy] run_ended (non-stream): memory_op=${event.memory_operation_id ?? 'none'}`);
    }
  }

  if (idleTimer) {
    clearTimeout(idleTimer);
  }
  sendResponse();

  if (onComplete) {
    onComplete(contentParts.join(''));
  }

  if (memoryOperationId) {
    logger.info(`[Backboard Proxy] Awaiting memory operation ${memoryOperationId}...`);
    const result = await client.waitForMemoryOperation(memoryOperationId).catch((err) => {
      logger.warn(`[Backboard Proxy] Memory operation poll failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    });
    logger.info(`[Backboard Proxy] Memory operation ${memoryOperationId} → ${result?.status ?? 'timeout'}`);
  }
}

let cachedModels: { id: string; object: string; created: number; owned_by: string }[] | null = null;
let modelsCacheExpiry = 0;

const MODELS_CACHE_TTL_MS = 3600_000;

async function fetchBackboardModels(): Promise<
  { id: string; object: string; created: number; owned_by: string }[]
> {
  const now = Date.now();
  if (cachedModels && now < modelsCacheExpiry) {
    return cachedModels;
  }

  const apiKey = process.env.BACKBOARD_API_KEY;
  const baseUrl = process.env.BACKBOARD_BASE_URL ?? 'https://app.backboard.io/api';

  if (!apiKey) {
    return [];
  }

  const providersRes = await fetch(`${baseUrl}/models/providers`, {
    headers: { 'X-API-Key': apiKey },
  });
  const { providers = [] } = (await providersRes.json()) as { providers: string[] };

  const allModels: { id: string; object: string; created: number; owned_by: string }[] = [];

  const PAGE_SIZE = 500;

  for (const provider of providers) {
    let skip = 0;
    let total = 0;

    do {
      const modelsRes = await fetch(
        `${baseUrl}/models?provider=${encodeURIComponent(provider)}&model_type=llm&skip=${skip}&limit=${PAGE_SIZE}`,
        { headers: { 'X-API-Key': apiKey } },
      );
      const data = (await modelsRes.json()) as {
        models: { name: string; model_type: string; provider: string }[];
        total: number;
      };

      total = data.total ?? 0;

      for (const m of data.models ?? []) {
        if (m.model_type !== 'llm') {
          continue;
        }
        allModels.push({
          id: `${m.provider}/${m.name}`,
          object: 'model',
          created: 1700000000,
          owned_by: m.provider,
        });
      }

      skip += PAGE_SIZE;
    } while (skip < total);
  }

  cachedModels = allModels;
  modelsCacheExpiry = now + MODELS_CACHE_TTL_MS;
  logger.info(`[Backboard] Cached ${allModels.length} models from ${providers.length} providers`);
  return allModels;
}

export async function handleListModels(_req: Request, res: Response): Promise<void> {
  try {
    const models = await fetchBackboardModels();
    res.json({ object: 'list', data: models });
  } catch (err) {
    logger.error('[Backboard] Error fetching models:', err);
    res.json({ object: 'list', data: [] });
  }
}
