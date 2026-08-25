// All sound is synthesised — no audio files to load, and a bead "tick" that fires
// several times a second stays free of the decode/instance cost sample playback has.

import { save } from "./save";
import { platform } from "../platform";

let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  // ⚠ The host's mute **outranks** the in-game toggle — their rules say so explicitly, and a
  // player who muted the page must not get sound back by tapping the speaker in here. Checked
  // live on every sound rather than mirrored into a flag: every sound in this game is a
  // one-shot, so there is no loop already playing that a change event would have to catch.
  if (save.muted || platform.hostMuted()) return null;
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

type Tone = {
  freq: number;
  to?: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
};

function play({ freq, to, dur, type = "sine", gain = 0.16, delay = 0 }: Tone) {
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to != null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** Short noise burst — the body of a marble knocking against glass. */
function clack(gain: number, rate: number) {
  const a = ac();
  if (!a) return;
  const len = Math.floor(a.sampleRate * 0.035);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    // Exponentially decayed noise reads as a hard little knock; a pure tone reads as a beep.
    d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 9);
  }
  const src = a.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const bp = a.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1500 * rate;
  bp.Q.value = 1.4;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(bp).connect(g).connect(a.destination);
  src.start();
}

/**
 * Boxes popping off close together read as one run, and the bell climbs a step per box.
 *
 * ⚠ The ladder is **pentatonic**, not chromatic or a plain ratio. A run's length is decided by
 * how the player set the belt up, so any number of steps has to land somewhere consonant — a
 * chromatic climb turns a five-box run into a siren. C D E G A, then the octave and up.
 *
 * The window is measured from the *previous box*, not from the start of the run, so a steady
 * stream of clears keeps climbing and a pause anywhere drops back to the bottom note.
 */
const CHAIN_MS = 1000;
const CHAIN_STEPS = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2, 9 / 4, 5 / 2];
let chainAt = 0;
let chain = 0;

/** Rising pitch as a block fills, so the ear tracks progress without reading the %. */
export const sfx = {
  collect(progress: number) {
    play({ freq: 520 + progress * 420, dur: 0.07, type: "triangle", gain: 0.07 });
  },
  pick() {
    play({ freq: 380, to: 620, dur: 0.1, type: "square", gain: 0.08 });
  },
  deny() {
    play({ freq: 220, to: 150, dur: 0.14, type: "sawtooth", gain: 0.07 });
  },
  complete() {
    [660, 880, 1180].forEach((f, i) =>
      play({ freq: f, dur: 0.16, type: "triangle", gain: 0.12, delay: i * 0.06 }),
    );
  },
  win() {
    [523, 659, 784, 1047].forEach((f, i) =>
      play({ freq: f, dur: 0.32, type: "triangle", gain: 0.14, delay: i * 0.11 }),
    );
  },
  booster() {
    play({ freq: 300, to: 1200, dur: 0.28, type: "sine", gain: 0.12 });
  },

  /** A tray tipping its marbles into the chute — a soft down-sweep plus a rattle. */
  release() {
    play({ freq: 640, to: 280, dur: 0.22, type: "triangle", gain: 0.09 });
    for (let i = 0; i < 3; i++) {
      setTimeout(() => clack(0.05, 1.1 + Math.random() * 0.5), 40 + i * 55);
    }
  },

  /**
   * One marble knocking something on the way down. Driven off real Matter collisions and
   * rate-limited by the caller — the whole point of the physics is that this never plays the
   * same rhythm twice, so it must not be a loop.
   */
  tumble(strength: number) {
    clack(0.03 + Math.min(0.06, strength * 0.035), 0.85 + Math.random() * 0.6);
  },

  /** A marble dropping into its hole — pitch climbs with the hole it filled. */
  seat(progress: number) {
    clack(0.05, 1.3 + progress * 0.5);
    play({ freq: 480 + progress * 300, dur: 0.06, type: "sine", gain: 0.05 });
  },

  /**
   * The third marble seating and the box popping off the stack.
   *
   * ⚠ Punctuation, not an event — this fires several times a level. It also has to be *unlike*
   * `complete`: the old version was a rising triangle arpeggio, which is exactly what `complete`
   * is, so the two ran together and a box popping sounded like the level ending. A cork-pop with
   * a struck bell over it reads as an object leaving instead of a fanfare, and the descent
   * contrasts against `seat`, whose pitch has just climbed across the three holes.
   */
  boxClear(): number {
    const now = performance.now();
    chain = now - chainAt < CHAIN_MS ? Math.min(chain + 1, CHAIN_STEPS.length - 1) : 0;
    chainAt = now;
    const step = CHAIN_STEPS[chain];

    // The pop stays put. It is the sound of the *object* leaving, so it should not move — only
    // the bell over it carries the run, or a long chain ends up sounding like a different box.
    clack(0.06, 1.9);
    play({ freq: 880, to: 240, dur: 0.07, type: "sine", gain: 0.09 });

    // The bell: one strike and a fifth over it, starting low so a run has somewhere to climb to,
    // and decaying fast so it never overlaps the next box.
    play({ freq: 784 * step, dur: 0.22, type: "triangle", gain: 0.06, delay: 0.03 });
    play({ freq: 1176 * step, dur: 0.16, type: "sine", gain: 0.032, delay: 0.03 });

    // ⚠ Returns how many boxes this run is up to, 1-based, because the scene throws fireworks on
    // the third and there must be **one** definition of "in a row". A second timer in `GameScene`
    // would be measuring the same thing from a different clock: the two drift within a frame or
    // two of `CHAIN_MS`, and the run where the bell climbs but nothing lights up reads as the
    // fireworks being broken. The ear already knows what a run is — let the eye ask it.
    return chain + 1;
  },

  starPop(n: number) {
    play({ freq: 600 + n * 220, dur: 0.24, type: "triangle", gain: 0.13 });
  },
};
