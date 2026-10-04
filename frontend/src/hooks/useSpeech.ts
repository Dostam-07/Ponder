import { create } from "zustand";
import { sanitizeForSpeech } from "../lib/speech";

/**
 * Shared voice-output state. ONE utterance app-wide: starting a new speak() cancels
 * the previous one, pause/resume/stop are real, and volume/rate are read from prefs
 * by the caller. Backed by window.speechSynthesis — real browser audio, no fakery.
 */

interface SpeechState {
  supported: boolean;
  /** "idle" | "speaking" | "paused" */
  state: "idle" | "speaking" | "paused";
  /** Id of the content currently being spoken (e.g. node id) — used for per-node button state. */
  activeId: string | null;
  speak: (opts: { id: string; text: string; volume: number; rate: number }) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  /** Toggle for a specific id: idle→speak, speaking→pause, paused→resume. */
  toggle: (opts: { id: string; text: string; volume: number; rate: number }) => void;
}

/** Module-level so onend/onerror handlers can update the store without stale closures. */
let currentId: string | null = null;

export const useSpeechStore = create<SpeechState>((set, get) => {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;

  const mark = (state: SpeechState["state"]) =>
    set({ state, activeId: state === "idle" ? null : currentId });

  return {
    supported: !!synth,
    state: "idle",
    activeId: null,

    speak: ({ id, text, volume, rate }) => {
      if (!synth) return;
      const plain = sanitizeForSpeech(text, 4500);
      if (!plain) return;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(plain);
      u.volume = Math.min(1, Math.max(0, volume));
      u.rate = Math.min(2, Math.max(0.5, rate));
      u.onend = () => {
        if (currentId === id) {
          currentId = null;
          mark("idle");
        }
        currentId = null;
      };
      u.onerror = () => {
        if (currentId === id) {
          currentId = null;
          mark("idle");
        }
      };
      currentId = id;
      mark("speaking");
      synth.speak(u);
    },

    pause: () => {
      if (!synth) return;
      synth.pause();
      mark("paused");
    },

    resume: () => {
      if (!synth) return;
      synth.resume();
      mark("speaking");
    },

    stop: () => {
      if (!synth) return;
      synth.cancel();
      currentId = null;
      mark("idle");
    },

    toggle: (opts) => {
      const st = get().state;
      if (st === "speaking" && currentId === opts.id) {
        get().pause();
      } else if (st === "paused" && currentId === opts.id) {
        get().resume();
      } else {
        get().speak(opts);
      }
    },
  };
});

