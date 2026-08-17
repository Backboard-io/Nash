import { atom } from 'recoil';
import { TSubmission } from 'librechat-data-provider';

// current submission
// submit any new value to this state will cause new message to be send.
// set to null to give up any submission

const submission = atom<TSubmission | null>({
  key: 'submission',
  default: null,
});

const isSubmitting = atom({
  key: 'isSubmitting',
  default: false,
});

export default {
  submission,
  isSubmitting,
};
