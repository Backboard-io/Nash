import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RecoilRoot, useRecoilValue } from 'recoil';
import store, { ephemeralAgentByConvoId } from '~/store';
import ImageGeneration from './ImageGeneration';
import VoiceModeButton from '~/components/Chat/Voice/VoiceModeButton';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
//
// Keep real Recoil + the real `~/store` so these tests exercise the actual
// imageModelByConversation / ttsVoiceByConversation atomFamilies (the same atoms
// the submission path and VoiceMode read), not stand-ins. Only the dropdown UI
// shell and the badge-row context are mocked.
// ─────────────────────────────────────────────────────────────────────────────

// Shared, mutable badge-row context (prefixed `mock` so jest allows it inside
// the factory). Tests flip `conversationId` / image-gen on/off as needed.
const mockBadgeCtx: {
  conversationId: string;
  imageGeneration: { toggleState: boolean; setToggleState: jest.Mock };
} = {
  conversationId: 'conv-1',
  imageGeneration: { toggleState: false, setToggleState: jest.fn() },
};

jest.mock('~/Providers', () => ({
  useBadgeRowContext: () => mockBadgeCtx,
}));

// DropdownPopup: render the trigger and, when open, the items as buttons so a
// click drives the component's real onClick. TooltipAnchor: render its element.
jest.mock('@librechat/client', () => ({
  DropdownPopup: ({ trigger, items, isOpen, setIsOpen }: any) => (
    <div>
      <div onClick={() => setIsOpen?.(!isOpen)}>{trigger}</div>
      {isOpen && (
        <div data-testid="dropdown-menu">
          {items.map((item: any, idx: number) => (
            <button key={idx} onClick={item.onClick} data-testid={`menu-item-${idx}`}>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  ),
  TooltipAnchor: ({ render }: any) => render,
}));

jest.mock('@ariakit/react', () => ({
  MenuButton: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

// VoiceModeButton pulls in the fullscreen overlay + navigation/query plumbing;
// none of it is relevant to the voice-picker atom write, so stub it out.
jest.mock('~/components/Chat/Voice/VoiceMode', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('~/hooks', () => ({
  useNavigateToConvo: () => ({ navigateToConvo: jest.fn() }),
}));
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => jest.fn(),
}));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({
    invalidateQueries: jest.fn(),
    refetchQueries: jest.fn(),
    fetchQuery: jest.fn(),
  }),
}));

beforeEach(() => {
  mockBadgeCtx.conversationId = 'conv-1';
  mockBadgeCtx.imageGeneration = { toggleState: false, setToggleState: jest.fn() };
});

describe('Composer per-conversation controls', () => {
  describe('ImageGeneration — one control that toggles image-gen + picks the model', () => {
    // Probe reads the real atom the submission path consumes.
    const ModelProbe = ({ id }: { id: string }) => {
      const v = useRecoilValue(store.imageModelByConversation(id));
      return <span data-testid={`img-${id}`}>{v || 'EMPTY'}</span>;
    };

    it('lists Off + the shared models, and picking a model enables image-gen and writes the choice scoped to its own conversation', () => {
      render(
        <RecoilRoot>
          <ImageGeneration />
          <ModelProbe id="conv-1" />
          <ModelProbe id="conv-2" />
        </RecoilRoot>,
      );

      const trigger = screen.getByRole('button', { name: /image generation/i });
      // Off → label reads "Image"; atom starts empty.
      expect(within(trigger).getByText('Image')).toBeInTheDocument();
      expect(screen.getByTestId('img-conv-1')).toHaveTextContent('EMPTY');

      fireEvent.click(trigger);
      // Off entry + the same model list as Settings → Preferences.
      expect(screen.getByText('Off')).toBeInTheDocument();
      expect(screen.getByText('Gemini 3.1 Flash Image')).toBeInTheDocument();
      expect(screen.queryByText('Gemini 2.5 Flash Image')).not.toBeInTheDocument();
      expect(screen.queryByText('GPT Image 1')).not.toBeInTheDocument();
      fireEvent.click(screen.getByText('Gemini 3.1 Flash Image'));

      // Image generation is turned on…
      expect(mockBadgeCtx.imageGeneration.setToggleState).toHaveBeenCalledWith(true);
      // …the atom this conversation submits with holds the choice…
      expect(screen.getByTestId('img-conv-1')).toHaveTextContent(
        'openrouter/google/gemini-3.1-flash-image-preview',
      );
      // …and a different conversation is unaffected (per-chat scoping).
      expect(screen.getByTestId('img-conv-2')).toHaveTextContent('EMPTY');
    });

    it('picking "Off" disables image generation', () => {
      mockBadgeCtx.imageGeneration.toggleState = true;
      render(
        <RecoilRoot>
          <ImageGeneration />
        </RecoilRoot>,
      );

      fireEvent.click(screen.getByRole('button', { name: /image generation/i }));
      fireEvent.click(screen.getByText('Off'));

      expect(mockBadgeCtx.imageGeneration.setToggleState).toHaveBeenCalledWith(false);
    });

    it('reflects the active model in the pill label when image generation is on', () => {
      mockBadgeCtx.imageGeneration.toggleState = true;
      render(
        <RecoilRoot
          initializeState={({ set }) => {
            set(
              store.imageModelByConversation('conv-1'),
              'openrouter/google/gemini-3.1-flash-image-preview',
            );
          }}
        >
          <ImageGeneration />
        </RecoilRoot>,
      );

      const trigger = screen.getByRole('button', { name: /image generation/i });
      expect(within(trigger).getByText('Gemini 3.1 Flash Image')).toBeInTheDocument();
    });
  });

  describe('VoiceModeButton — per-conversation TTS voice, scoped + isolated', () => {
    // Probe reads the real atom the picker writes (and that VoiceMode consumes).
    const VoiceProbe = ({ id }: { id: string }) => {
      const v = useRecoilValue(store.ttsVoiceByConversation(id));
      return <span data-testid={`voice-${id}`}>{v || 'EMPTY'}</span>;
    };

    it('writes the selected voice to ttsVoiceByConversation for its own conversation only', () => {
      render(
        <RecoilRoot>
          <VoiceModeButton />
          <VoiceProbe id="conv-1" />
          <VoiceProbe id="conv-2" />
        </RecoilRoot>,
      );

      // The chevron (split-button) opens the voice picker; the audio icon opens
      // the overlay and is a separate control.
      expect(screen.getByRole('button', { name: /open voice mode/i })).toBeInTheDocument();
      expect(screen.getByTestId('voice-conv-1')).toHaveTextContent('EMPTY');

      fireEvent.click(screen.getByRole('button', { name: /choose voice/i }));
      fireEvent.click(screen.getByText('Nova'));

      // The atom this conversation reads now holds the choice…
      expect(screen.getByTestId('voice-conv-1')).toHaveTextContent('nova');
      // …and a different conversation is unaffected (per-chat scoping).
      expect(screen.getByTestId('voice-conv-2')).toHaveTextContent('EMPTY');
    });
  });
});
