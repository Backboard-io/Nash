export interface BackboardAssistant {
  assistant_id: string;
  name: string;
  description?: string;
  tools?: BackboardToolDefinition[];
  embedding_provider?: string;
  embedding_model_name?: string;
  embedding_dims?: number;
  created_at: string;
}

export interface BackboardThread {
  thread_id: string;
  created_at: string;
  messages: BackboardMessage[];
  metadata?: Record<string, unknown>;
}

export interface BackboardMessage {
  message_id: string;
  role: 'user' | 'assistant' | 'system';
  content?: string;
  created_at: string;
  status?: string;
  metadata?: Record<string, unknown>;
  attachments?: BackboardAttachment[];
}

export interface BackboardAttachment {
  document_id: string;
  filename: string;
  status: string;
  file_size_bytes: number;
  summary?: string;
}

export interface BackboardMessageResponse {
  message: string;
  thread_id: string;
  content?: string;
  message_id: string;
  role: 'user' | 'assistant' | 'system';
  status?: string;
  tool_calls?: BackboardToolCall[];
  run_id?: string;
  model_provider?: string;
  model_name?: string;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  created_at?: string;
  timestamp: string;
}

export interface BackboardToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface BackboardToolDefinition {
  type: string;
  function?: {
    name: string;
    description?: string;
    parameters: {
      type: string;
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface BackboardDocument {
  document_id: string;
  filename: string;
  status: 'pending' | 'processing' | 'indexed' | 'failed';
  created_at: string;
  status_message?: string;
  summary?: string;
  file_size_bytes?: number;
}

export interface BackboardMemory {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
  score?: number;
  created_at?: string;
  updated_at?: string;
}

export interface BackboardMemoriesListResponse {
  memories: BackboardMemory[];
  total_count: number;
}

export interface BackboardStreamEvent {
  type: string;
  content?: string;
  error?: string;
  message?: string;
  status?: string;
  memories?: BackboardMemory[];
  run_id?: string;
  tool_calls?: BackboardToolCall[];
  model_provider?: string;
  model_name?: string;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  memory_operation_id?: string;
  retrieved_memories?: BackboardMemory[];
}

export interface BackboardMemoryOperationStatus {
  operation_id: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  events?: Array<{ type: string; content?: string }>;
}

/** OpenAI-compatible types for the proxy layer */

export interface OpenAITextContentPart {
  type: 'text';
  text: string;
}

export interface OpenAIImageUrlContentPart {
  type: 'image_url';
  image_url: { url: string };
}

export type OpenAIContentPart = OpenAITextContentPart | OpenAIImageUrlContentPart;

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenAIContentPart[] | null;
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAIChatCompletionRequest {
  model: string;
  messages: OpenAIChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  user?: string;
}

export interface OpenAIChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAIChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
