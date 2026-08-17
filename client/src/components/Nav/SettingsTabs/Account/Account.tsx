import React from 'react';
import DisplayUsernameMessages from './DisplayUsernameMessages';
import BackboardApiKey from './BackboardApiKey';
import DeleteAccount from './DeleteAccount';
import DangerZone from './DangerZone';
import Nickname from './Nickname';
import Avatar from './Avatar';

function Account() {
  return (
    <div className="flex flex-col divide-y divide-border-light p-1 text-sm text-text-primary">
      <div className="py-3.5">
        <Nickname />
      </div>
      <div className="py-3.5">
        <DisplayUsernameMessages />
      </div>
      <div className="py-3.5">
        <Avatar />
      </div>
      <div className="py-3.5">
        <BackboardApiKey />
      </div>
      <div className="py-3.5">
        <DeleteAccount />
      </div>
      <div className="py-3.5">
        <DangerZone />
      </div>
    </div>
  );
}

export default React.memo(Account);
