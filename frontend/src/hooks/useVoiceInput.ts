import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Real browser speech-to-text (Web Speech API). No fake states: IDLE → LISTENING →
 * TRANSCRIBING → text lands in the composer via onTranscript. Listening is continuous
 * with interim results; stop() finalizes. Errors are surfaced, never swallowed.
 */

/** Minimal typings for webkitSpeechRecognition (not in the TS DOM lib). */
interface SRAlternative {
  transcript: string;
  confidence: number;
}
interface SRResult {
  isFinal: boolean;
  length: number;
  0: SRAlternative;
}
interface SRResultList {
  length: number;
  item: (i: number) => SRResult;
  [i: number]: SRResult;
}
interface SREvent extends Event {
  resultIndex: number;
  results: SRResultList;
}
interface SRErrorEvent extends Event {
  error: string;
  message?: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type SRConstructor = new () => SpeechRecognitionLike;

function getSR(): SRConstructor | null {
  const w = window as unknown as {
    SpeechRecognition?: SRConstructor;
    webkitSpeechRecognition?: SRConstructor;
    SpeechRecognitionConstructor?: SRConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type VoiceState = "idle" | "listening" | "transcribing";

export interface VoiceInput {
  state: VoiceState;
  /** True when the browser exposes SpeechRecognition. */
  supported: boolean;
  /** Seconds elapsed while listening. */
  duration: number;
  /** Live interim transcript while listening (not yet final). */
  interim: string;
  /** Human-readable last error ("microphone-denied" | "no-speech" | …). */
  error: "microphone-denied" | "no-speech" | "failed" | null;
  start: () => void;
  stop: () => void;
  cancel: () => void;
  clearError: () => void;
}

export function useVoiceInput(onTranscript: (text: string) => void): VoiceInput {
  const supported = !!getSR();
  const [state, setState] = useState<VoiceState>("idle");
  const [duration, setDuration] = useState(0);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<VoiceInput["error"] | null>(null);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef("");
  const timerRef = useRef<number | undefined>(undefined);
  /** guards against an errant onend restart after an intentional cancel */
  const intentionalRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const cleanupTimer = useCallback(() => {
    if (timerRef.current !== undefined) {
      window.clearInterval(timerRef.current);
      timerRef.current = undefined;
    }
  }, []);

  const cancel = useCallback(() => {
    intentionalRef.current = true;
    cleanupTimer();
    setDuration(0);
    setInterim("");
    try {
      recRef.current?.abort();
    } catch {
      /* already stopped */
    }
    recRef.current = null;
    setState("idle");
  }, [cleanupTimer]);

  const stop = useCallback(() => {
    if (state !== "listening") return;
    cleanupTimer();
    setDuration(0);
    setInterim("");
    // If nothing was captured at all, go straight back to idle.
    if (!finalRef.current.trim()) {
      intentionalRef.current = true;
      try {
        recRef.current?.stop();
      } catch {
        /* already stopped */
      }
      recRef.current = null;
      setState("idle");
      return;
    }
    setState("transcribing");
    try {
      recRef.current?.stop(); // onend fires → flush
    } catch {
      /* already stopped */
    }
  }, [state, cleanupTimer]);

  const start = useCallback(() => {
    const SR = getSR();
    if (!SR || state !== "idle") return;
    setError(null);
    finalRef.current = "";
    const rec = new SR();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      setState("listening");
      setDuration(0);
      timerRef.current = window.setInterval(() => setDuration((d) => d + 1), 1000);
    };

    rec.onresult = (e: SREvent) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        if (r.isFinal) finalRef.current += r[0]!.transcript;
        else interimText += r[0]!.transcript;
      }
      setInterim(interimText);
    };

    rec.onerror = (e: SRErrorEvent) => {
      if (e.error === "no-speech" && !finalRef.current.trim()) {
        setError("no-speech");
      } else if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setError("microphone-denied");
      } else if (e.error !== "aborted") {
        setError("failed");
      }
    };

    rec.onend = () => {
      cleanupTimer();
      recRef.current = null;
      if (intentionalRef.current) {
        intentionalRef.current = false;
        setState("idle");
        return;
      }
      // Natural end (e.g. engine cut us off): if we captured speech, deliver it.
      const text = finalRef.current.trim();
      if (text) {
        setState("transcribing");
        window.setTimeout(() => {
          onTranscriptRef.current(text);
          setState("idle");
          finalRef.current = "";
        }, 450); // brief "Transcribing…" beat so the state is perceivable
      } else {
        setState("idle");
      }
    };

    intentionalRef.current = false;
    recRef.current = rec;
    try {
      rec.start();
    } catch {
      setState("idle");
      setError("failed");
    }
  }, [state, cleanupTimer]);

  // Stop speech on unmount so the mic indicator never lingers.
  useEffect(
    () => () => {
      intentionalRef.current = true;
      try {
        recRef.current?.abort();
      } catch {
        /* ignore */
      }
      cleanupTimer();
    },
    [cleanupTimer],
  );

  const clearError = useCallback(() => setError(null), []);

  return { state, supported, duration, interim, error, start, stop, cancel, clearError };
}
