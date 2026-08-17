const mockNavigate = jest.fn();
const mockSetAbortScroll = jest.fn();
const mockAnnouncePolite = jest.fn();
const mockApplyAgentTemplate = jest.fn();
const mockAttachmentHandler = jest.fn();
const mockContentHandler = jest.fn();
const mockResetContentHandler = jest.fn();
const mockStepHandler = jest.fn();
const mockClearStepMaps = jest.fn();
const mockSyncStepMessage = jest.fn();
const mockSetMessages = jest.fn();
const mockGetMessages = jest.fn(() => []);
const mockSetCompleted = jest.fn();
const mockSetIsSubmitting = jest.fn();
const mockSetShowStopButton = jest.fn();
const mockQueryClient = {
  invalidateQueries: jest.fn(),
  getQueryData: jest.fn(),
  setQueryData: jest.fn(),
};

jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/c/existing-conversation' }),
  useNavigate: () => mockNavigate,
  useParams: () => ({ conversationId: 'existing-conversation' }),
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => mockQueryClient,
}));

jest.mock('recoil', () => ({
  useSetRecoilState: () => mockSetAbortScroll,
}));

jest.mock('~/Providers', () => ({
  useLiveAnnouncer: () => ({ announcePolite: mockAnnouncePolite }),
}));

jest.mock('~/hooks/Agents', () => ({
  useApplyAgentTemplate: () => mockApplyAgentTemplate,
}));

jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: () => ({ token: null }),
}));

jest.mock('~/hooks/SSE/useAttachmentHandler', () => ({
  __esModule: true,
  default: () => mockAttachmentHandler,
}));

jest.mock('~/hooks/SSE/useContentHandler', () => ({
  __esModule: true,
  default: () => ({
    contentHandler: mockContentHandler,
    resetContentHandler: mockResetContentHandler,
  }),
}));

jest.mock('~/hooks/SSE/useStepHandler', () => ({
  __esModule: true,
  default: () => ({
    stepHandler: mockStepHandler,
    clearStepMaps: mockClearStepMaps,
    syncStepMessage: mockSyncStepMessage,
  }),
}));

jest.mock('~/data-provider/SSE/queries', () => ({
  queueTitleGeneration: jest.fn(),
}));

jest.mock('~/utils', () => ({
  logger: { log: jest.fn() },
  setDraft: jest.fn(),
  scrollToEnd: jest.fn(),
  getAllContentText: jest.fn(() => ''),
  addConvoToAllQueries: jest.fn(),
  updateConvoInAllQueries: jest.fn(),
  removeConvoFromAllQueries: jest.fn(),
  findConversationInInfinite: jest.fn(),
}));

jest.mock('~/store', () => ({
  __esModule: true,
  default: { abortScroll: {} },
}));

import { act, renderHook } from '@testing-library/react';
import { Constants } from 'librechat-data-provider';
import type { EventSubmission } from 'librechat-data-provider';
import type { TResData } from '~/common';
import useEventHandlers from '~/hooks/SSE/useEventHandlers';
import type { EventHandlerParams } from '~/hooks/SSE/useEventHandlers';

const CONVERSATION_ID = 'new-conversation-id';

const createParams = (
  overrides: Partial<EventHandlerParams> = {},
): EventHandlerParams => ({
  setMessages: mockSetMessages,
  getMessages: mockGetMessages,
  setCompleted: mockSetCompleted,
  setIsSubmitting: mockSetIsSubmitting,
  setShowStopButton: mockSetShowStopButton,
  ...overrides,
});

const createSubmission = (
  overrides: Record<string, unknown> = {},
): EventSubmission =>
  ({
    messages: [],
    userMessage: {
      messageId: 'user-message-id',
      conversationId: CONVERSATION_ID,
      parentMessageId: Constants.NO_PARENT,
      isCreatedByUser: true,
      sender: 'User',
      text: 'Hello',
    },
    initialResponse: {
      messageId: 'initial-response-id',
      conversationId: Constants.NEW_CONVO,
      parentMessageId: 'user-message-id',
      isCreatedByUser: false,
      sender: 'Nash',
      text: '',
    },
    conversation: {
      conversationId: Constants.NEW_CONVO,
    },
    isTemporary: false,
    ...overrides,
  }) as unknown as EventSubmission;

const createdData = {
  created: true,
  responseMessageId: 'response-message-id',
} as unknown as TResData;

describe('useEventHandlers createdHandler URL commit', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/c/existing-conversation');
  });

  it('uses the live pathname when an SSE listener retains an older handler', () => {
    const { result } = renderHook(() => useEventHandlers(createParams()));
    const retainedCreatedHandler = result.current.createdHandler;

    window.history.pushState({}, '', `/c/${Constants.NEW_CONVO}`);
    const replaceState = jest.spyOn(window.history, 'replaceState');

    act(() => {
      retainedCreatedHandler(createdData, createSubmission());
    });

    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState).toHaveBeenCalledWith(
      expect.anything(),
      '',
      `/c/${CONVERSATION_ID}`,
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not commit while the browser is on an existing conversation', () => {
    const { result } = renderHook(() => useEventHandlers(createParams()));
    const replaceState = jest.spyOn(window.history, 'replaceState');

    act(() => {
      result.current.createdHandler(createdData, createSubmission());
    });

    expect(replaceState).not.toHaveBeenCalled();
  });

  it('does not commit a temporary conversation', () => {
    window.history.replaceState({}, '', `/c/${Constants.NEW_CONVO}`);
    const { result } = renderHook(() => useEventHandlers(createParams()));
    const replaceState = jest.spyOn(window.history, 'replaceState');

    act(() => {
      result.current.createdHandler(createdData, createSubmission({ isTemporary: true }));
    });

    expect(replaceState).not.toHaveBeenCalled();
  });

  it('does not commit an added response', () => {
    window.history.replaceState({}, '', `/c/${Constants.NEW_CONVO}`);
    const { result } = renderHook(() =>
      useEventHandlers(createParams({ isAddedRequest: true })),
    );
    const replaceState = jest.spyOn(window.history, 'replaceState');

    act(() => {
      result.current.createdHandler(createdData, createSubmission());
    });

    expect(replaceState).not.toHaveBeenCalled();
  });
});
