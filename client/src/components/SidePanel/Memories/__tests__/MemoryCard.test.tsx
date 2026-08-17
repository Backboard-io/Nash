import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import type { TUserMemory } from 'librechat-data-provider';
import MemoryCard from '../MemoryCard';

const translations: Record<string, string> = {
  com_ui_token: 'token',
  com_ui_tokens: 'tokens',
  com_ui_saved: 'Saved!',
  com_ui_error: 'Something went wrong',
  com_ui_edit_memory: 'Edit memory',
  com_ui_cancel: 'Cancel',
  com_ui_save: 'Save',
};

const mockUpdateMutate = jest.fn((_args: unknown, opts?: { onSuccess?: () => void }) =>
  opts?.onSuccess?.(),
);
const mockShowToast = jest.fn();

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => translations[key] || key,
}));

jest.mock('~/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

jest.mock('@librechat/client', () => ({
  Spinner: () => <span data-testid="spinner" />,
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('~/data-provider', () => ({
  useUpdateMemoryMutation: () => ({ mutate: mockUpdateMutate, isLoading: false }),
}));

// Replace actions with a minimal edit trigger so we can drive the edit flow.
jest.mock('../MemoryCardActions', () => ({
  __esModule: true,
  default: ({ onEdit }: { onEdit: () => void }) => (
    <button type="button" onClick={onEdit}>
      edit-trigger
    </button>
  ),
}));

const memory: TUserMemory = {
  key: 'k1',
  value: 'original value',
  updated_at: '2026-04-07T00:00:00.000Z',
  tokenCount: 20,
};

const enterEditMode = () => fireEvent.click(screen.getByText('edit-trigger'));

describe('MemoryCard', () => {
  beforeEach(() => {
    mockUpdateMutate.mockClear();
    mockShowToast.mockClear();
  });

  test('renders value and token metadata in view mode', () => {
    render(<MemoryCard memory={memory} hasUpdateAccess />);
    expect(screen.getByText('original value')).toBeInTheDocument();
    expect(screen.getByText('20 tokens')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  test('clicking edit reveals the textarea seeded with the current value', () => {
    render(<MemoryCard memory={memory} hasUpdateAccess />);
    enterEditMode();
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();
    expect(textarea.value).toBe('original value');
  });

  test('Save is disabled until the value changes', () => {
    render(<MemoryCard memory={memory} hasUpdateAccess />);
    enterEditMode();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'updated value' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  test('saving sends the trimmed value, toasts success, and exits edit mode', () => {
    render(<MemoryCard memory={memory} hasUpdateAccess />);
    enterEditMode();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  updated value  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockUpdateMutate).toHaveBeenCalledWith(
      { key: 'k1', value: 'updated value' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
    expect(mockShowToast).toHaveBeenCalledWith({ message: 'Saved!', status: 'success' });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  test('cancel discards the draft and exits edit mode without saving', () => {
    render(<MemoryCard memory={memory} hasUpdateAccess />);
    enterEditMode();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'discard me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mockUpdateMutate).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('original value')).toBeInTheDocument();
  });
});
