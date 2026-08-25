/// <reference types="vite/client" />

// Build-time constants injected by Vite's `define` (see vite.config.ts).
declare const __APP_VERSION__: string; // e.g. "0.0.7" (0.0.<git commit count>)
declare const __APP_BUILD__: string; //   short git commit hash, or "local"
declare const __TARGET__: "web" | "crazy" | "android"; // which host this build is for

/**
 * The platform door, resolved by alias in `vite.config.ts` from `VITE_TARGET`.
 * ⚠ Import from `./platform`, never from `virtual:platform` directly — the alias is an
 * implementation detail of the build and `src/platform/index.ts` is the only place that knows it.
 */
declare module "virtual:platform" {
  import type { Platform } from "./platform/base";
  export const platform: Platform;
}
