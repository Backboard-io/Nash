import type { InfiniteData } from '@tanstack/react-query';
import type {
  TSavedMessageFolder,
  TConversationTag,
  TSavedMessage,
  EModelEndpoint,
  TConversation,
  TSharedLink,
  TAttachment,
  TMessage,
  TBanner,
} from './schemas';
import type { SettingDefinition } from './generate';
import type { TMinimalFeedback } from './feedback';
import type { TModelConfig } from './models';
import type { ContentTypes } from './types/runs';
import type { Agent } from './types/assistants';

export * from './schemas';

export type TMessages = TMessage[];

/* TODO: Cleanup EndpointOption types */
export type TEndpointOption = Pick<
  TConversation,
  // Core conversation fields
  | 'endpoint'
  | 'endpointType'
  | 'model'
  | 'modelLabel'
  | 'chatGptLabel'
  | 'promptPrefix'
  | 'temperature'
  | 'topP'
  | 'topK'
  | 'top_p'
  | 'frequency_penalty'
  | 'presence_penalty'
  | 'maxOutputTokens'
  | 'maxContextTokens'
  | 'max_tokens'
  | 'maxTokens'
  | 'resendFiles'
  | 'imageDetail'
  | 'reasoning_effort'
  | 'verbosity'
  | 'instructions'
  | 'additional_instructions'
  | 'append_current_datetime'
  | 'tools'
  | 'stop'
  | 'region'
  | 'additionalModelRequestFields'
  // Anthropic-specific
  | 'promptCache'
  | 'thinking'
  | 'thinkingBudget'
  | 'thinkingLevel'
  | 'effort'
  // Assistant/Agent fields
  | 'assistant_id'
  | 'agent_id'
  // UI/Display fields
  | 'iconURL'
  | 'greeting'
  | 'spec'
  // Artifacts
  | 'artifacts'
  // Files
  | 'file_ids'
  // System field
  | 'system'
  // Google examples
  | 'examples'
  // Context
  | 'context'
> & {
  // Fields specific to endpoint options that don't exist on TConversation
  modelDisplayLabel?: string;
  key?: string | null;
  /** @deprecated Assistants API */
  thread_id?: string;
  // Conversation identifiers for multi-response streams
  overrideConvoId?: string;
  overrideUserMessageId?: string;
  // Model parameters (used by different endpoints)
  modelOptions?: Record<string, unknown>;
  model_parameters?: Record<string, unknown>;
  // Configuration data (added by middleware)
  modelsConfig?: TModelsConfig;
  // File attachments (processed by middleware)
  attachments?: TAttachment[];
  // Generated prompts
  artifactsPrompt?: string;
  // Agent-specific fields
  agent?: Promise<Agent>;
  // Client-specific options
  clientOptions?: Record<string, unknown>;
};

export type TEphemeralAgent = {
  mcp?: string[];
  web_search?: boolean;
  /** Backboard Image Tool — per-turn toggle. When true, the chat model can
   *  invoke an image-generation tool call. Default model picked server-side. */
  image_generation?: boolean;
  /** Per-user default image model preference, "<provider>/<model_name>".
   *  Validated against an allow-list server-side; only used when
   *  image_generation is on. Empty/unset means the deploy default. */
  image_model?: string;
  file_search?: boolean;
  execute_code?: boolean;
  artifacts?: string;
  memory?: 'Auto' | 'On' | 'Off';
};

/** One image attached to an assistant message via the Backboard Image Tool. */
export type TGeneratedMedia = {
  documentId: string;
  mimeType: string;
  url: string;
  fileSizeBytes?: number;
};

export type TPayload = Partial<TMessage> &
  Partial<TEndpointOption> & {
    isContinued: boolean;
    isRegenerate?: boolean;
    conversationId: string | null;
    messages?: TMessages;
    isTemporary: boolean;
    ephemeralAgent?: TEphemeralAgent | null;
    editedContent?: TEditedContent | null;
    /** Added conversation for multi-convo feature */
    addedConvo?: TConversation;
    folderId?: string;
  };

export type TEditedContent =
  | {
      index: number;
      type: ContentTypes.THINK;
      [ContentTypes.THINK]: string;
    }
  | {
      index: number;
      type: ContentTypes.TEXT;
      [ContentTypes.TEXT]: string;
    };

export type TSubmission = {
  userMessage: TMessage;
  isEdited?: boolean;
  isContinued?: boolean;
  isTemporary: boolean;
  messages: TMessage[];
  isRegenerate?: boolean;
  initialResponse?: TMessage;
  conversation: Partial<TConversation>;
  endpointOption: TEndpointOption;
  clientTimestamp?: string;
  ephemeralAgent?: TEphemeralAgent | null;
  editedContent?: TEditedContent | null;
  /** Added conversation for multi-convo feature */
  addedConvo?: TConversation;
};

export type EventSubmission = Omit<TSubmission, 'initialResponse'> & { initialResponse: TMessage };

export type TPluginAction = {
  pluginKey: string;
  action: 'install' | 'uninstall';
  auth?: Partial<Record<string, string>> | null;
  isEntityTool?: boolean;
};

export type GroupedConversations = [key: string, TConversation[]][];

export type TUpdateUserPlugins = {
  isEntityTool?: boolean;
  pluginKey: string;
  action: string;
  auth?: Partial<Record<string, string | null>> | null;
};

// TODO `label` needs to be changed to the proper `TranslationKeys`
export type TCategory = {
  id?: string;
  value: string;
  label: string;
  description?: string;
  custom?: boolean;
};

export type TMarketplaceCategory = TCategory & {
  count: number;
};

export type TError = {
  message: string;
  code?: number | string;
  response?: {
    data?: {
      message?: string;
    };
    status?: number;
  };
};

export type TBackupCode = {
  codeHash: string;
  used: boolean;
  usedAt: Date | null;
};

export type TUser = {
  id: string;
  username: string;
  email: string;
  name: string;
  nickname?: string;
  avatar: string;
  role: string;
  provider: string;
  plugins?: string[];
  twoFactorEnabled?: boolean;
  backupCodes?: TBackupCode[];
  personalization?: {
    memories?: boolean;
  };
  createdAt: string;
  updatedAt: string;
};

export type TGetConversationsResponse = {
  conversations: TConversation[];
  pageNumber: string;
  pageSize: string | number;
  pages: string | number;
};

export type TUpdateMessageRequest = {
  conversationId: string;
  messageId: string;
  model: string;
  text: string;
};

export type TUpdateMessageContent = {
  conversationId: string;
  messageId: string;
  index: number;
  text: string;
};

export type TUpdateUserKeyRequest = {
  name: string;
  value: string;
  expiresAt: string;
};

export type TAgentApiKeyCreateRequest = {
  name: string;
  expiresAt?: string | null;
};

export type TAgentApiKeyCreateResponse = {
  id: string;
  name: string;
  key: string;
  keyPrefix: string;
  createdAt: string;
  expiresAt?: string;
};

export type TAgentApiKeyListItem = {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt?: string;
  expiresAt?: string;
  createdAt: string;
};

export type TAgentApiKeyListResponse = {
  keys: TAgentApiKeyListItem[];
};

export type TUpdateConversationRequest = {
  conversationId: string;
  title?: string;
  isPinned?: boolean;
};

export type TUpdateConversationResponse = TConversation;

export type TDeleteConversationRequest = {
  conversationId?: string;
  thread_id?: string;
  endpoint?: string;
  source?: string;
};

export type TDeleteConversationResponse = {
  acknowledged: boolean;
  deletedCount: number;
  messages: {
    acknowledged: boolean;
    deletedCount: number;
  };
};

export type TArchiveConversationRequest = {
  conversationId: string;
  isArchived: boolean;
};

export type TArchiveConversationResponse = TConversation;

export type TSharedMessagesResponse = Omit<TSharedLink, 'messages'> & {
  messages: TMessage[];
};

export type TCreateShareLinkRequest = Pick<TConversation, 'conversationId'>;

export type TUpdateShareLinkRequest = Pick<TSharedLink, 'shareId'>;

export type TSharedLinkResponse = Pick<TSharedLink, 'shareId'> &
  Pick<TConversation, 'conversationId'>;

export type TSharedLinkGetResponse = TSharedLinkResponse & {
  success: boolean;
};

// type for getting conversation tags
export type TConversationTagsResponse = TConversationTag[];
// type for creating conversation tag
export type TConversationTagRequest = Partial<
  Omit<TConversationTag, 'createdAt' | 'updatedAt' | 'count' | 'user'>
> & {
  conversationId?: string;
  addToConversation?: boolean;
};

export type TConversationTagResponse = TConversationTag;

/* Saved responses */

export type TSavedMessagesResponse = TSavedMessage[];

/** POST body. Idempotent on `messageId`: re-saving preserves note/folder/createdAt. */
export type TSaveMessageRequest = {
  messageId: string;
  conversationId: string;
  text: string;
  context?: string;
  note?: string;
  folderId?: string | null;
  model?: string;
  endpoint?: string;
  title?: string;
};

/** PATCH body. `folderId: null` (or `'unsorted'`) moves the row back to Unsorted. */
export type TUpdateSavedMessageRequest = {
  note?: string;
  folderId?: string | null;
};

export type TSavedMessageFoldersResponse = TSavedMessageFolder[];

export type TSavedMessageFolderRequest = {
  name?: string;
  description?: string;
};

export type TDeleteSavedFolderResponse = {
  message: string;
  movedToUnsorted: number;
};

export type TTagConversationRequest = {
  tags: string[];
  tag: string;
};

export type TTagConversationResponse = string[];

export type TDuplicateConvoRequest = {
  conversationId?: string;
};

export type TDuplicateConvoResponse = {
  conversation: TConversation;
  messages: TMessage[];
};

export type TForkConvoRequest = {
  messageId: string;
  conversationId: string;
  option?: string;
  splitAtTarget?: boolean;
  latestMessageId?: string;
};

export type TForkConvoResponse = {
  conversation: TConversation;
  messages: TMessage[];
};

export type TSearchResults = {
  conversations: TConversation[];
  messages: TMessage[];
  pageNumber: string;
  pageSize: string | number;
  pages: string | number;
  filter: object;
};

export type TConfig = {
  order: number;
  type?: EModelEndpoint;
  azure?: boolean;
  availableTools?: [];
  availableRegions?: string[];
  plugins?: Record<string, string>;
  name?: string;
  iconURL?: string;
  version?: string;
  modelDisplayLabel?: string;
  userProvide?: boolean | null;
  userProvideURL?: boolean | null;
  disableBuilder?: boolean;
  retrievalModels?: string[];
  capabilities?: string[];
  customParams?: {
    defaultParamsEndpoint?: string;
    paramDefinitions?: Partial<SettingDefinition>[];
  };
};

export type TEndpointsConfig =
  | Record<EModelEndpoint | string, TConfig | null | undefined>
  | undefined;

export type TModelsConfig = Record<string, Array<string | TModelConfig>>;

export type TUpdateTokenCountResponse = {
  count: number;
};

export type TMessageTreeNode = object;

export type TSearchMessage = object;

export type TSearchMessageTreeNode = object;

export type TRegisterUserResponse = {
  message: string;
  email?: string;
};

export type TRegisterUser = {
  name?: string;
  first_name?: string;
  last_name?: string;
  email: string;
  username?: string;
  password: string;
  confirm_password?: string;
  token?: string;
  referralCode?: string;
  referral_code?: string;
  promoCode?: string;
  turnstile_token?: string;
  company_name?: string;
  company_website?: string;
  industry?: string;
  company_size?: string;
  use_case?: string;
  billing_email?: string;
};

export type TLoginUser = {
  email: string;
  password: string;
  token?: string;
  backupCode?: string;
  turnstile_token?: string;
  return_to?: string;
  /** Client-only: whether to persist the session past the current tab. */
  remember?: boolean;
};

export type TLoginResponse = {
  message?: string;
  email?: string;
  session_key?: string;
  session_token?: string;
  expires_at?: string;
  token?: string;
  user?: TUser;
  twoFAPending?: boolean;
  mfaSetupRequired?: boolean;
  tempToken?: string;
};

/* Multi-org Backboard contexts (org switcher). Keyless by design —
 * API keys live server-side only. */
export type TBackboardContext = {
  contextId: string;
  displayName: string;
  isPersonal: boolean;
  isActive: boolean;
  available: boolean;
};

export type TAuthContextsResponse = {
  contexts: TBackboardContext[];
  activeContextId: string;
};

export type TSwitchContextRequest = {
  contextId: string;
};

export type TSwitchContextResponse = {
  activeContextId: string;
  displayName: string;
};

export type TEnable2FAResponse = {
  otpauthUrl: string;
  backupCodes: string[];
  message?: string;
};

export type TVerify2FARequest = {
  token?: string;
  backupCode?: string;
};

export type TVerify2FAResponse = {
  message: string;
  token?: string;
  user?: TUser;
};

/**
 * For verifying 2FA during login with a temporary token.
 */
export type TVerify2FATempRequest = {
  tempToken: string;
  token?: string;
  backupCode?: string;
};

export type TVerify2FATempResponse = {
  token?: string;
  user?: TUser;
  message?: string;
};

/**
 * Request for disabling 2FA.
 */
export type TDisable2FARequest = {
  token?: string;
  backupCode?: string;
};

/**
 * Response from disabling 2FA.
 */
export type TDisable2FAResponse = {
  message: string;
};

/**
 * Response from regenerating backup codes.
 */
export type TRegenerateBackupCodesResponse = {
  message: string;
  backupCodes: string[];
  backupCodesHash: string[];
};

export type TRequestPasswordReset = {
  email: string;
};

export type TResetPassword = {
  userId: string;
  token: string;
  password: string;
  confirm_password?: string;
};

export type VerifyEmailResponse = {
  message: string;
  session_token?: string;
  expires_at?: string;
  user?: TUser;
  link?: string;
  token?: string;
};

export type TVerifyEmail = {
  email?: string;
  token: string;
  client_timestamp?: string;
};

export type TResendVerificationEmail = Omit<TVerifyEmail, 'token'>;

export type TRefreshTokenResponse = {
  token: string;
  user: TUser;
};

export type TCheckUserKeyResponse = {
  expiresAt: string;
};

export type TRequestPasswordResetResponse = {
  link?: string;
  message?: string;
};

/**
 * Represents the response from the import endpoint.
 */
export type TImportResponse = {
  /**
   * The message associated with the response.
   */
  message: string;
};

/** Prompts */

export type TPrompt = {
  groupId: string;
  author: string;
  prompt: string;
  type: 'text' | 'chat';
  createdAt: string;
  updatedAt: string;
  _id?: string;
};

export type TPromptGroup = {
  name: string;
  numberOfGenerations?: number;
  command?: string;
  oneliner?: string;
  category?: string;
  projectIds?: string[];
  productionId?: string | null;
  productionPrompt?: Pick<TPrompt, 'prompt'> | null;
  author: string;
  authorName: string;
  createdAt?: Date;
  updatedAt?: Date;
  _id?: string;
};

export type TCreatePrompt = {
  prompt: Pick<TPrompt, 'prompt' | 'type'> & { groupId?: string };
  group?: { name: string; category?: string; oneliner?: string; command?: string };
};

export type TCreatePromptRecord = TCreatePrompt & Pick<TPromptGroup, 'author' | 'authorName'>;

export type TPromptsWithFilterRequest = {
  groupId: string;
  tags?: string[];
  projectId?: string;
  version?: number;
};

export type TPromptGroupsWithFilterRequest = {
  category: string;
  pageNumber?: string; // Made optional for cursor-based pagination
  pageSize?: string | number;
  limit?: string | number; // For cursor-based pagination
  cursor?: string; // For cursor-based pagination
  before?: string | null;
  after?: string | null;
  order?: 'asc' | 'desc';
  name?: string;
  author?: string;
};

export type PromptGroupListResponse = {
  promptGroups: TPromptGroup[];
  pageNumber: string;
  pageSize: string | number;
  pages: string | number;
  has_more: boolean; // Added for cursor-based pagination
  after: string | null; // Added for cursor-based pagination
};

export type PromptGroupListData = InfiniteData<PromptGroupListResponse>;

export type TCreatePromptResponse = {
  prompt: TPrompt;
  group?: TPromptGroup;
};

export type TUpdatePromptGroupPayload = Partial<TPromptGroup> & {
  removeProjectIds?: string[];
};

export type TUpdatePromptGroupVariables = {
  id: string;
  payload: TUpdatePromptGroupPayload;
};

export type TUpdatePromptGroupResponse = TPromptGroup;

export type TDeletePromptResponse = {
  prompt: string;
  promptGroup?: { message: string; id: string };
};

export type TDeletePromptVariables = {
  _id: string;
  groupId: string;
};

export type TMakePromptProductionResponse = {
  message: string;
};

export type TMakePromptProductionRequest = {
  id: string;
  groupId: string;
  productionPrompt: Pick<TPrompt, 'prompt'>;
};

export type TUpdatePromptLabelsRequest = {
  id: string;
  payload: {
    labels: string[];
  };
};

export type TUpdatePromptLabelsResponse = {
  message: string;
};

export type TDeletePromptGroupResponse = TUpdatePromptLabelsResponse;

export type TDeletePromptGroupRequest = {
  id: string;
};

export type TGetCategoriesResponse = TCategory[];

export type TGetRandomPromptsResponse = {
  prompts: TPromptGroup[];
};

export type TGetRandomPromptsRequest = {
  limit: number;
  skip: number;
};

export type TCustomConfigSpeechResponse = { [key: string]: string };

export type TUserTermsResponse = {
  termsAccepted: boolean;
};

export type TAcceptTermsResponse = {
  success: boolean;
};

export type TChatAssistantResponse = {
  system_prompt: string;
};

export type TBannerResponse = TBanner | null;

export type TUpdateFeedbackRequest = {
  feedback?: TMinimalFeedback;
};

export type TUpdateFeedbackResponse = {
  messageId: string;
  conversationId: string;
  feedback?: TMinimalFeedback;
};

export type TBalanceResponse = {
  tokenCredits: number;
  tokenCreditsUsd?: number;
  /** Personal Nash pool remaining/allocation; null = could not read (treat
   * as unknown, never as empty). */
  nashCreditsUsd?: number | null;
  nashAllocationUsd?: number | null;
  /** Backboard wallet (paid + subscription) — pays when the pool is empty. */
  backboardCreditsUsd?: number | null;
  // Automatic refill settings
  autoRefillEnabled: boolean;
  refillIntervalValue?: number;
  refillIntervalUnit?: 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks' | 'months';
  lastRefill?: Date;
  refillAmount?: number;
};

export type TPlan = {
  id: string;
  name: string;
  priceUsd: number | null;
  priceSuffix?: string;
  allocationUsd: number | null;
  tagline: string;
  bullets: string[];
  popular?: boolean;
  action: 'select' | 'contact';
};

/** 'backboard' → Backboard bills this account's usage; Nash shows
 * "Backboard plan" and disables its own billing UI. */

export type TPlansResponse = {
  plans: TPlan[];
  currentPlan: string;
  stripeActive?: boolean;
};

export type TSelectPlanResponse = {
  plan: string;
  allocationUsd: number;
  allocated: boolean;
};

export type TPlanCheckoutResponse = {
  /** Present when a NEW subscription is needed — redirect the browser here. */
  url?: string;
  /** Present when an EXISTING subscription was scheduled to change at period end. */
  scheduled?: boolean;
  /** Unix seconds when the scheduled change takes effect (current period end). */
  effectiveAt?: number | null;
  plan?: string;
};

export type TSubscription = {
  status: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: number | null;
  cardBrand: string | null;
  cardLast4: string | null;
  /** Set when a switch is scheduled to take effect at the period end. */
  scheduledPlan?: string | null;
  scheduledPlanName?: string | null;
};

export type TSubscriptionResponse = {
  plan: string;
  subscription: TSubscription | null;
};

export type TCancelSubscriptionResponse = {
  subscription: TSubscription | null;
};

export type TBillingAddress = {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
};

export type TBillingInfo = {
  email?: string | null;
  name?: string | null;
  address?: TBillingAddress | null;
};

export type TPaymentMethod = {
  id: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
};

export type TInvoice = {
  id: string;
  created: number;
  amountPaid: number;
  currency: string;
  status: string;
  hostedInvoiceUrl: string | null;
  number: string | null;
};

export type TBillingOverview = {
  billingInfo: TBillingInfo;
  paymentMethods: TPaymentMethod[];
  invoices: TInvoice[];
};

export type TBillingResponse = TBillingOverview & {
  plan: string;
  subscription: TSubscription | null;
};

export type TReferralSummary = {
  referralCode: string;
  referralLink: string;
  rewardTokenCredits: number;
  rewardUsd: number;
  referredByCode?: string | null;
  stats: {
    signups: number;
    paidConversions: number;
  };
  recentReferrals: Array<{
    userId: string;
    name: string;
    referredAt?: string | null;
    rewardGrantedAt?: string | null;
  }>;
};

export type TRedeemCodeResponse = {
  kind: 'promo' | 'referral';
  balance: TBalanceResponse;
  code?: string;
  tokenCreditsAwarded?: number;
  usdValue?: number;
  referralCode?: string;
  referrerUserId?: string;
};

export type TPromoCode = {
  code: string;
  tokenCreditsAwarded: number;
  usdValue?: number | null;
  active: boolean;
  maxUses?: number | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

/** Aggregate storage usage for the Library rail (GET /api/files/usage). */
export type TFileUsageCategory = { count: number; bytes: number };
export type TFileUsage = {
  usedBytes: number;
  fileCount: number;
  /** Display ceiling from STORAGE_LIMIT_BYTES — not an enforced quota. */
  limitBytes: number;
  byCategory: {
    documents: TFileUsageCategory;
    images: TFileUsageCategory;
    other: TFileUsageCategory;
  };
};
