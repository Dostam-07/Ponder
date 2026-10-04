import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "dark" | "light";

export type PonderIconId =
  | "spark"
  | "lightbulb"
  | "star"
  | "compass"
  | "brain"
  | "book"
  | "atom"
  | "orbit";

const THEME_KEY = "ponder.theme";
const ICON_KEY = "ponder.icon";
const AUDIO_KEY = "ponder.audio";

export interface AudioPrefs {
  /** Whether response audio (Listen) is enabled at all. */
  voiceResponses: boolean;
  /** Auto-speak completed responses. Default OFF — never blast audio unexpectedly. */
  autoPlay: boolean;
  /** Speech volume 0–1. */
  volume: number;
  /** Speech rate 0.6–1.6. */
  rate: number;
}

const DEFAULT_AUDIO: AudioPrefs = {
  voiceResponses: true,
  autoPlay: false,
  volume: 1,
  rate: 1.02,
};

function readAudio(): AudioPrefs {
  try {
    const raw = localStorage.getItem(AUDIO_KEY);
    if (!raw) return { ...DEFAULT_AUDIO };
    const parsed = JSON.parse(raw) as Partial<AudioPrefs>;
    return {
      voiceResponses: parsed.voiceResponses ?? DEFAULT_AUDIO.voiceResponses,
      autoPlay: parsed.autoPlay ?? DEFAULT_AUDIO.autoPlay,
      volume: typeof parsed.volume === "number" ? Math.min(1, Math.max(0, parsed.volume)) : DEFAULT_AUDIO.volume,
      rate: typeof parsed.rate === "number" ? Math.min(1.6, Math.max(0.6, parsed.rate)) : DEFAULT_AUDIO.rate,
    };
  } catch {
    return { ...DEFAULT_AUDIO };
  }
}

function readTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* private mode */
  }
  return "dark";
}

function readIcon(): PonderIconId {
  try {
    const v = localStorage.getItem(ICON_KEY);
    if (v) return v as PonderIconId;
  } catch {
    /* private mode */
  }
  return "spark";
}

interface PrefsValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  icon: PonderIconId;
  setIcon: (i: PonderIconId) => void;
  audio: AudioPrefs;
  setAudio: (patch: Partial<AudioPrefs>) => void;
}

const PrefsContext = createContext<PrefsValue | null>(null);

/**
 * Single source of truth for client preferences (theme + Ponder icon).
 * Persisted to localStorage — the appropriate store for a local, single-user app
 * (the server DB holds content, not client appearance).
 */
export function PrefsProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const [icon, setIconState] = useState<PonderIconId>(readIcon);
  const [audio, setAudioState] = useState<AudioPrefs>(readAudio);

  // Apply theme by toggling the class the index.css variables key off.
  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(ICON_KEY, icon);
    } catch {
      /* ignore */
    }
  }, [icon]);

  useEffect(() => {
    try {
      localStorage.setItem(AUDIO_KEY, JSON.stringify(audio));
    } catch {
      /* ignore */
    }
  }, [audio]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggleTheme = useCallback(() => setThemeState((t) => (t === "dark" ? "light" : "dark")), []);
  const setIcon = useCallback((i: PonderIconId) => setIconState(i), []);
  const setAudio = useCallback((patch: Partial<AudioPrefs>) => setAudioState((a) => ({ ...a, ...patch })), []);

  return (
    <PrefsContext.Provider value={{ theme, setTheme, toggleTheme, icon, setIcon, audio, setAudio }}>
      {children}
    </PrefsContext.Provider>
  );
}

export function usePrefs(): PrefsValue {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error("usePrefs must be used inside <PrefsProvider>");
  return ctx;
}
