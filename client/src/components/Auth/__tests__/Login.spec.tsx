import { render, fireEvent, waitFor } from '@testing-library/react';
import Login from '~/components/Auth/Login';

const mockApiKeyLogin = jest.fn();
let mockError: string | undefined = undefined;

jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: () => ({
    error: mockError,
    apiKeyLogin: mockApiKeyLogin,
  }),
}));

describe('Login (API-key only)', () => {
  beforeEach(() => {
    mockApiKeyLogin.mockClear();
    mockError = undefined;
  });

  test('renders only the API-key form — no email or password fields', () => {
    const { getByLabelText, queryByLabelText, getByRole, container } = render(<Login />);

    expect(getByLabelText(/backboard api key/i)).toBeInTheDocument();
    expect(getByRole('button', { name: /start chatting/i })).toBeInTheDocument();

    expect(queryByLabelText(/email/i)).not.toBeInTheDocument();
    expect(container.querySelector('input[type="email"]')).not.toBeInTheDocument();
    expect(container.querySelector('input[name="password"]')).not.toBeInTheDocument();
  });

  test('submits the trimmed API key', async () => {
    const { getByLabelText, getByRole } = render(<Login />);

    fireEvent.change(getByLabelText(/backboard api key/i), {
      target: { value: '  bb_test_key_123  ' },
    });
    fireEvent.click(getByRole('button', { name: /start chatting/i }));

    await waitFor(() => {
      expect(mockApiKeyLogin).toHaveBeenCalledWith('bb_test_key_123');
    });
  });

  test('renders a server error message', () => {
    mockError = 'Invalid API key. Check your key at app.backboard.io/settings';
    const { getByText } = render(<Login />);
    expect(
      getByText(/invalid api key/i),
    ).toBeInTheDocument();
  });
});
