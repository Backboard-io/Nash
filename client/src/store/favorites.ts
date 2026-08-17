import { atom } from 'jotai';

export type Favorite = {
  agentId?: string;
  model?: string;
  endpoint?: string;
};

export type FavoriteModel = {
  model: string;
  endpoint: string;
};

export type FavoritesState = Favorite[];

/** Previously used by `atomWithStorage`; removed on startup so favorites are server-only. */
export const LEGACY_FAVORITES_STORAGE_KEY = 'favorites';

/**
 * In-memory favorites; hydrated from GET /api/user/settings/favorites (and /api/init seed).
 */
export const favoritesAtom = atom<FavoritesState>([]);
