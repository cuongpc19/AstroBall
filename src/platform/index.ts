// Picks the implementation. ⚠ By **alias**, resolved in `vite.config.ts` from `VITE_TARGET`.
//
// An `if (import.meta.env.VITE_TARGET === "crazy")` here would leave both files in the module
// graph and rely on the bundler folding the branch away. The alias means the one you did not
// select is never read at all, which is what makes `grep -rc crazygames dist/` a real proof
// rather than a hopeful one.
export { platform } from "virtual:platform";
export type { Platform, PlatformStorage } from "./base";
