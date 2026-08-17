import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import GoogleWorkspaceCatalog from '../GoogleWorkspaceCatalog';

const mockCatalogQuery = jest.fn();
const mockAddMutate = jest.fn().mockResolvedValue({ oauthRequired: true, oauthUrl: 'https://consent' });
const mockInitializeServer = jest.fn().mockResolvedValue({ oauthRequired: true, oauthUrl: 'https://consent' });
const mockShowToast = jest.fn();

jest.mock('~/data-provider/MCP/queries', () => ({
  useMCPCatalogQuery: () => mockCatalogQuery(),
}));
jest.mock('~/data-provider/MCP/mutations', () => ({
  useAddMCPCatalogServerMutation: () => ({ mutateAsync: mockAddMutate }),
}));
jest.mock('~/hooks', () => ({
  useLocalize:
    () =>
    (key: string, opts?: Record<string, string>) =>
      opts?.['0'] ? `${key}:${opts['0']}` : key,
}));
jest.mock('~/utils', () => ({ cn: (...a: unknown[]) => a.filter(Boolean).join(' ') }));
jest.mock('@librechat/client', () => ({
  useToastContext: () => ({ showToast: mockShowToast }),
  Button: ({ children, onClick, disabled, ...p }: any) => (
    <button onClick={onClick} disabled={disabled} {...p}>
      {children}
    </button>
  ),
  Spinner: () => <div data-testid="spinner" />,
}));

const ENTRIES = [
  { serverName: 'google-gmail', title: 'Gmail', description: 'Read mail', provider: 'google-workspace', alreadyAdded: false },
  { serverName: 'google-drive', title: 'Google Drive', description: 'Files', provider: 'google-workspace', alreadyAdded: true },
];

const mockIsInitializing = jest.fn().mockReturnValue(false);
let connectionStatus: Record<string, { connectionState: string }> = {};

function renderCatalog() {
  return render(
    <GoogleWorkspaceCatalog
      initializeServer={mockInitializeServer}
      isInitializing={mockIsInitializing}
      connectionStatus={connectionStatus}
    />,
  );
}

let popupHref = '';
const fakePopup = {
  closed: false,
  close: jest.fn(),
  get location() {
    return { set href(v: string) { popupHref = v; } } as unknown as Location;
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  connectionStatus = {};
  popupHref = '';
  mockIsInitializing.mockReturnValue(false);
  mockAddMutate.mockResolvedValue({ oauthRequired: true, oauthUrl: 'https://consent' });
  mockInitializeServer.mockResolvedValue({ oauthRequired: true, oauthUrl: 'https://consent' });
  window.open = jest.fn().mockReturnValue(fakePopup) as any;
});

test('renders nothing when the catalog is empty (provider not configured)', () => {
  mockCatalogQuery.mockReturnValue({ data: { catalog: [] } });
  const { container } = renderCatalog();
  expect(container).toBeEmptyDOMElement();
});

test('lists entries with Connect / Reconnect', () => {
  mockCatalogQuery.mockReturnValue({ data: { catalog: ENTRIES } });
  renderCatalog();
  expect(screen.getByText('Gmail')).toBeInTheDocument();
  expect(screen.getByText('com_ui_mcp_connect')).toBeInTheDocument();
  expect(screen.getByText('com_ui_mcp_reconnect')).toBeInTheDocument();
});

test('Connect opens the popup synchronously, adds, then navigates it to the consent URL', async () => {
  mockCatalogQuery.mockReturnValue({ data: { catalog: [ENTRIES[0]] } });
  renderCatalog();
  fireEvent.click(screen.getByText('com_ui_mcp_connect'));
  // Popup opened synchronously in the gesture (before any await resolves).
  expect(window.open).toHaveBeenCalledWith('about:blank', expect.any(String), expect.stringContaining('popup'));
  await waitFor(() => expect(mockAddMutate).toHaveBeenCalledWith('google-gmail'));
  expect(mockInitializeServer).toHaveBeenCalledWith('google-gmail', false);
  await waitFor(() => expect(popupHref).toBe('https://consent'));
});

test('add failure closes the popup and shows an error toast', async () => {
  mockCatalogQuery.mockReturnValue({ data: { catalog: [ENTRIES[0]] } });
  mockAddMutate.mockRejectedValueOnce(new Error('boom'));
  renderCatalog();
  fireEvent.click(screen.getByText('com_ui_mcp_connect'));
  await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
  expect(fakePopup.close).toHaveBeenCalled();
});

test('already-connected server shows Connected, no button', () => {
  connectionStatus = { 'google-gmail': { connectionState: 'connected' } };
  mockCatalogQuery.mockReturnValue({ data: { catalog: [ENTRIES[0]] } });
  renderCatalog();
  expect(screen.getByText('com_ui_mcp_connected')).toBeInTheDocument();
  expect(screen.queryByText('com_ui_mcp_connect')).not.toBeInTheDocument();
});
