import { atom } from 'jotai';
import { NotificationSeverity } from '~/common';

export const langAtom = atom<string>('en');
export const chatDirectionAtom = atom<string>('ltr');
export const fontSizeAtom = atom<string>('text-base');

export type ToastState = {
  open: boolean;
  message: string;
  severity: NotificationSeverity;
  showIcon: boolean;
  /** Optional inline action (Undo). See TShowToast. */
  action?: { label: string; onClick: () => void };
};

export const toastState = atom<ToastState>({
  open: false,
  message: '',
  severity: NotificationSeverity.SUCCESS,
  showIcon: true,
  action: undefined,
});
