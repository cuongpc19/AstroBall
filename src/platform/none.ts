// Self-hosted web build, and the fallback for the dev server. Every host hook is a no-op and
// storage is plain `localStorage`.
//
// This is also what proves the split works: nothing in this file mentions any host SDK, so a
// `web` build cannot contain one.

import { localStore, type Platform } from "./base";

export const platform: Platform = {
  name: "web",
  async init() {},
  storage: localStore,
  loadingStart() {},
  loadingStop() {},
  gameplayStart() {},
  gameplayStop() {},
  happytime() {},
  preferredLang: () => null,
  hostMuted: () => false,
  onHostMuteChange() {},
};
