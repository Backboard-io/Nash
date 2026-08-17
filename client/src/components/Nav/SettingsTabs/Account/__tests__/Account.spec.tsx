import React from 'react';
import { render, screen } from '@testing-library/react';
import Account from '../Account';

jest.mock('../DisplayUsernameMessages', () => () => <div>display-username</div>);
jest.mock('../DeleteAccount', () => () => <div>delete-account</div>);
jest.mock('../DangerZone', () => () => <div>danger-zone</div>);
jest.mock('../Nickname', () => () => <div>nickname</div>);
jest.mock('../Avatar', () => () => <div>avatar</div>);
jest.mock('../BackboardApiKey', () => () => <div>backboard-api-key</div>);

describe('Account', () => {
  it('renders the account items with no 2FA entries', () => {
    render(<Account />);

    expect(screen.getByText('backboard-api-key')).toBeInTheDocument();
    expect(screen.getByText('delete-account')).toBeInTheDocument();
    expect(screen.queryByText('two-factor-settings')).not.toBeInTheDocument();
  });
});
