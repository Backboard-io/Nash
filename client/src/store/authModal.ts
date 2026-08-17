import { atom } from 'recoil';

export type AuthModalTab = 'login' | 'register';

export const showAuthModalAtom = atom<boolean>({
  key: 'showAuthModal',
  default: false,
});

export const authModalTabAtom = atom<AuthModalTab>({
  key: 'authModalTab',
  default: 'login',
});
