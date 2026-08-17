import { renderHook, act, waitFor } from '@testing-library/react';
import useVoiceConversationRealtime from './useVoiceConversationRealtime';
import { openRealtimeSession } from '~/audio/realtimeSession';
import { startPcmCapture } from '~/audio/pcmCapture';
import { queueTitleGeneration } from '~/data-provider/SSE/queries';

jest.mock('~/audio/realtimeSession');
jest.mock('~/audio/pcmCapture');
jest.mock('~/audio/ttsPlayer', () => ({
  createTtsPlayer: () => ({ onLevel: jest.fn(), reset: jest.fn(), prepare: jest.fn(), stop: jest.fn() }),
}));
jest.mock('~/data-provider/SSE/queries', () => ({
  queueTitleGeneration: jest.fn(),
}));

const mockOpenRealtimeSession = openRealtimeSession as jest.Mock;
const mockStartPcmCapture = startPcmCapture as jest.Mock;
const mockQueueTitleGeneration = queueTitleGeneration as jest.Mock;

/** A session whose events() yields exactly the events pushed via emit(),
 *  then hangs until close() resolves the generator. */
function makeFakeSession(conversationId: string) {
  const pending: Array<{ type: string; [k: string]: unknown }> = [];
  let resolveNext: (() => void) | null = null;
  let closed = false;

  const emit = (ev: { type: string; [k: string]: unknown }) => {
    pending.push(ev);
    resolveNext?.();
  };

  return {
    session: {
      sendPcm: jest.fn(),
      commit: jest.fn(),
      sendControl: jest.fn(),
      isOpen: true,
      beginEvent: { type: 'session.begin', conversation_id: conversationId },
      close: jest.fn(() => {
        closed = true;
        resolveNext?.();
      }),
      async *events() {
        while (!closed) {
          if (pending.length > 0) {
            yield pending.shift()!;
            continue;
          }
          await new Promise<void>((resolve) => {
            resolveNext = resolve;
          });
        }
      },
    },
    emit,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStartPcmCapture.mockResolvedValue({
    setMuted: jest.fn(),
    stop: jest.fn(),
  });
});

describe('useVoiceConversationRealtime — title generation on run_ended', () => {
  it('queues title generation for a conversation the server just minted', async () => {
    const { session, emit } = makeFakeSession('minted-convo-123');
    mockOpenRealtimeSession.mockResolvedValue(session);

    const { result } = renderHook(() =>
      useVoiceConversationRealtime({ conversationId: undefined }),
    );

    await act(async () => {
      await result.current.begin();
    });

    act(() => emit({ type: 'run_ended', message_id: 'm1' }));

    await waitFor(() => {
      expect(mockQueueTitleGeneration).toHaveBeenCalledWith('minted-convo-123');
    });
    expect(mockQueueTitleGeneration).toHaveBeenCalledTimes(1);

    act(() => session.close());
  });

  it('does NOT queue title generation for an existing conversation', async () => {
    const { session, emit } = makeFakeSession('existing-convo-456');
    mockOpenRealtimeSession.mockResolvedValue(session);

    const { result } = renderHook(() =>
      useVoiceConversationRealtime({ conversationId: 'existing-convo-456' }),
    );

    await act(async () => {
      await result.current.begin();
    });

    act(() => emit({ type: 'run_ended', message_id: 'm1' }));
    // Give the event loop a tick to process — there's nothing to waitFor
    // on the negative case, so just flush microtasks.
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockQueueTitleGeneration).not.toHaveBeenCalled();

    act(() => session.close());
  });

  it('only fires once even if run_ended arrives on multiple turns', async () => {
    const { session, emit } = makeFakeSession('minted-convo-789');
    mockOpenRealtimeSession.mockResolvedValue(session);

    const { result } = renderHook(() =>
      useVoiceConversationRealtime({ conversationId: undefined }),
    );

    await act(async () => {
      await result.current.begin();
    });

    act(() => emit({ type: 'run_ended', message_id: 'm1' }));
    await waitFor(() => expect(mockQueueTitleGeneration).toHaveBeenCalledTimes(1));

    act(() => emit({ type: 'run_ended', message_id: 'm2' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockQueueTitleGeneration).toHaveBeenCalledTimes(1);

    act(() => session.close());
  });
});
