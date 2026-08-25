// The privacy policy, and the one control in the game that opens it.
//
// ⚠ **It has to be reachable from inside the game, not only from the submission form.** The
// sibling Hop In! project learned this the expensive way round: the host's rules say a game that
// collects anything beyond their own SDK's events must *display* the notice, and answering the
// form field is not displaying it. AstroBall does not currently cross that line — it sends
// nothing anywhere (see the page itself) — so this ships as the honest version of a notice rather
// than as a legal obligation. The moment a `fetch` to a server of ours appears, it becomes one.
//
// ⚠ **Same-origin, relative path.** The page rides along in the bundle (`public/privacy.html`),
// so it is served from wherever the game is served — the host's own CDN included. That sidesteps
// the outbound-link ban entirely: this is not a link off their site, it is a second page of the
// game. It also means the URL keeps working when the game is deployed somewhere new, which an
// absolute URL baked at build time would not.
//
// ⚠ **New tab, never navigate.** The game runs inside the host's iframe; replacing that document
// throws the player out of the level they are in the middle of.

/**
 * Where the policy lives, relative to the game's own `index.html`.
 *
 * ⚠ The submission form needs an **absolute** URL and cannot use this one — before the game is
 * approved there is no host copy to point at. Give the form the web deploy's own address instead
 * (`<domain>/privacy.html`); it is the same file, shipped by the same build.
 */
export const PRIVACY_URL = "privacy.html";

/** Open the policy in a new tab. Never throws — a blocked popup must not break the game. */
export function openPrivacyPolicy() {
  try {
    window.open(PRIVACY_URL, "_blank", "noopener,noreferrer");
  } catch {
    /* popup blocked, or no window at all — nothing to do, and nothing worth crashing over */
  }
}
