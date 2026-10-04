import { useVoiceInput } from "../../hooks/useVoiceInput";
import { MicIcon, StopIcon } from "./Icons";

interface Props {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

/**
 * Composer microphone button (spec §5–6): real Web Speech recognition with honest
 * states — IDLE (mic icon) → LISTENING (pulsing red mic + duration + stop/cancel)
 * → TRANSCRIBING ("Transcribing…") → text delivered for editing before sending.
 * Permission denial and errors are surfaced visibly, never silent.
 */
export function VoiceInputButton({ onTranscript, disabled }: Props) {
  const voice = useVoiceInput(onTranscript);

  if (!voice.supported) {
    return (
      <button
        type="button"
        className="btn-ghost !p-2 text-fog-400/50 cursor-not-allowed"
        title="Voice input isn't supported in this browser"
        aria-label="Voice input unavailable in this browser"
        disabled
      >
        <MicIcon />
      </button>
    );
  }

  const listening = voice.state === "listening";
  const transcribing = voice.state === "transcribing";

  return (
    <div className="relative flex items-center">
      {(listening || transcribing) && (
        <div
          className="absolute bottom-full mb-2 right-0 popover-surface px-3 py-2 flex items-center gap-2.5 whitespace-nowrap z-30"
          role="status"
          aria-live="polite"
          aria-label={listening ? `Listening, ${voice.duration} seconds` : "Transcribing"}
        >
          {listening ? (
            <>
              <span className="relative flex items-center justify-center w-4 h-4" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full rounded-full bg-red-500/40 animate-ping" />
                <span className="relative inline-flex w-2 h-2 rounded-full bg-red-500" />
              </span>
              <span className="text-xs text-fog-200">Listening… {voice.duration}s</span>
              {voice.interim && <span className="text-xs text-fog-400 italic max-w-[180px] truncate">{voice.interim}</span>}
              <button type="button" className="text-xs text-spark-400 hover:text-spark-300 font-medium" onClick={voice.stop} title="Stop and use the transcript">
                Done
              </button>
              <button type="button" className="text-xs text-fog-400 hover:text-fog-200" onClick={voice.cancel} title="Cancel recording">
                Cancel
              </button>
            </>
          ) : (
            <span className="text-xs text-fog-300 flex items-center gap-1.5">
              <span className="w-3 h-3 animate-spin inline-block border-2 border-spark-400 border-t-transparent rounded-full" aria-hidden="true" />
              Transcribing…
            </span>
          )}
        </div>
      )}

      {voice.error && (
        <div
          className="absolute bottom-full mb-2 right-0 popover-surface px-3 py-2 text-xs max-w-[240px] z-30"
          role="alert"
        >
          {voice.error === "microphone-denied" ? (
            <>
              <p className="text-fog-100 font-medium">Microphone blocked</p>
              <p className="text-fog-400 mt-0.5">Allow microphone access for this site in your browser settings, then try again.</p>
            </>
          ) : voice.error === "no-speech" ? (
            <p className="text-fog-300">No speech detected — try again a bit closer to your mic.</p>
          ) : (
            <p className="text-fog-300">Voice input failed. Try again.</p>
          )}
          <button className="text-spark-400 hover:text-spark-300 mt-1" onClick={voice.clearError}>
            Dismiss
          </button>
        </div>
      )}

      <button
        type="button"
        className={`btn-ghost !p-2 ${listening ? "!text-red-400" : transcribing ? "!text-spark-400" : "text-fog-400"}`}
        title={listening ? "Stop recording" : "Voice input"}
        aria-label={listening ? "Stop voice recording" : "Start voice input"}
        aria-pressed={listening}
        disabled={disabled || transcribing}
        onClick={() => (listening ? voice.stop() : voice.start())}
      >
        {listening ? <span className="relative animate-pulse inline-flex"><MicIcon /></span> : <MicIcon />}
      </button>

      {listening && <StopIcon className="w-2 h-2 text-red-400 absolute bottom-1.5 right-1.5 pointer-events-none" aria-hidden="true" />}
    </div>
  );
}
