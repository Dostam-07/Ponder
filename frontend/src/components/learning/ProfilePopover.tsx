import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { LearningProfile, LearningGoal, LearningLevel, LearningStyle, LearningTime } from "@canvas-learn/shared";
import { api } from "../../lib/api";
import { useCanvasStore } from "../../stores/canvasStore";
import { usePrefs } from "../../hooks/usePrefs";
import { useSpeechStore } from "../../hooks/useSpeech";
import { Drawer } from "../ui/Drawer";
import { CheckIcon } from "../ui/Icons";

const GOALS: { id: LearningGoal; label: string }[] = [
  { id: "basics", label: "Understand the basics" },
  { id: "exam", label: "Prepare for an exam" },
  { id: "deep", label: "Go deep" },
  { id: "practical", label: "Apply it practically" },
  { id: "build", label: "Build something" },
  { id: "review", label: "Review what I know" },
];
const LEVELS: { id: LearningLevel; label: string }[] = [
  { id: "beginner", label: "Beginner" },
  { id: "intermediate", label: "Intermediate" },
  { id: "advanced", label: "Advanced" },
];
const STYLES: { id: LearningStyle; label: string }[] = [
  { id: "simple", label: "Concise" },
  { id: "analogy", label: "Analogy-heavy" },
  { id: "visual", label: "Visual" },
  { id: "mathematical", label: "Mathematical" },
  { id: "practical", label: "Practical" },
  { id: "socratic", label: "Socratic" },
];
const TIMES: { id: LearningTime; label: string }[] = [
  { id: "5", label: "5 minutes" },
  { id: "15", label: "15 minutes" },
  { id: "30", label: "30 minutes" },
  { id: "deep", label: "Deep dive" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  /** Trigger element to restore focus to on close. */
  openerRef?: React.RefObject<HTMLButtonElement | null>;
}

/**
 * Personalize drawer (spec §1–2, §8): values are saved per canvas and injected as
 * concrete writing directives into every answer prompt — real behavior, not labels.
 * Changes apply instantly (persisted on each change) with a visible "Saved" state.
 * Audio preferences (voice output on/off, autoplay, volume, speed) live here too.
 */
export function ProfilePopover({ open, onClose, openerRef }: Props) {
  const canvasId = useCanvasStore((s) => s.canvasId);
  const profile = useCanvasStore((s) => s.profile);
  const setProfileLocal = useCanvasStore((s) => s.setProfile);
  const qc = useQueryClient();
  const { audio, setAudio } = usePrefs();
  const speech = useSpeechStore();

  const save = useMutation({
    mutationFn: (p: LearningProfile) => api.setProfile(canvasId!, p),
    onSuccess: ({ profile }) => {
      setProfileLocal(profile);
      qc.invalidateQueries({ queryKey: ["graph", canvasId] });
    },
  });

  const set = (patch: Partial<LearningProfile>) => {
    const next = { ...(profile ?? { goal: "basics", level: "beginner", style: "simple", time: "15" }), ...patch } as LearningProfile;
    setProfileLocal(next); // instant UI feedback
    save.mutate(next);
  };

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="mb-5">
      <p className="text-[11px] uppercase tracking-wide text-fog-400 mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
        {children}
      </div>
    </div>
  );

  const Opt = ({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) => (
    <button
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`text-xs rounded-full px-2.5 py-1 border transition-colors ${
        active ? "border-spark-500 bg-spark-500/15 text-spark-400" : "border-ink-700 text-fog-300 hover:border-ink-600"
      }`}
    >
      {label}
      {active && <CheckIcon className="w-3 h-3 inline ml-1 -mt-0.5" aria-hidden="true" />}
    </button>
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Personalize"
      hint="These settings change how Ponder responds — every answer adapts to them."
    >
      {!canvasId ? (
        <p className="text-sm text-fog-400">Open a canvas to personalize how Ponder teaches you there.</p>
      ) : (
        <>
          <Row label="Goal">
            {GOALS.map((g) => (
              <Opt key={g.id} label={g.label} active={profile?.goal === g.id} onClick={() => set({ goal: g.id })} />
            ))}
          </Row>
          <Row label="Level">
            {LEVELS.map((l) => (
              <Opt key={l.id} label={l.label} active={profile?.level === l.id} onClick={() => set({ level: l.id })} />
            ))}
          </Row>
          <Row label="Style">
            {STYLES.map((s) => (
              <Opt key={s.id} label={s.label} active={profile?.style === s.id} onClick={() => set({ style: s.id })} />
            ))}
          </Row>
          <Row label="Time">
            {TIMES.map((t) => (
              <Opt key={t.id} label={t.label} active={profile?.time === t.id} onClick={() => set({ time: t.id })} />
            ))}
          </Row>
          <p className="text-[11px] text-fog-400 -mt-2 mb-5" role="status">
            {save.isPending ? "Saving…" : save.isError ? "Could not save — try again" : "Saved automatically as you change settings"}
          </p>
        </>
      )}

      {/* ---- voice output (spec §8) ---- */}
      <div className="border-t border-ink-700/70 pt-4">
        <p className="text-[11px] uppercase tracking-wide text-fog-400 mb-3">Voice output</p>

        <div className="flex items-center justify-between py-1.5">
          <span className="text-sm text-fog-200">Voice responses</span>
          <Toggle checked={audio.voiceResponses} onChange={(v) => setAudio({ voiceResponses: v })} label="Voice responses" />
        </div>

        <div className="flex items-center justify-between py-1.5">
          <span className="text-sm text-fog-200">
            Auto-play responses
            <span className="block text-[11px] text-fog-400">Ponder reads each answer aloud when it completes</span>
          </span>
          <Toggle checked={audio.autoPlay} onChange={(v) => setAudio({ autoPlay: v })} label="Auto-play responses" />
        </div>

        <div className="py-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-fog-200">Volume</span>
            <span className="text-xs text-fog-400" aria-hidden="true">
              {Math.round(audio.volume * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={audio.volume}
            onChange={(e) => setAudio({ volume: Number(e.target.value) })}
            onMouseUp={() => speech.stop()}
            className="w-full mt-1.5 accent-[rgb(var(--c-spark-400))]"
            aria-label={`Voice volume: ${Math.round(audio.volume * 100)} percent`}
          />
        </div>

        <div className="py-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-fog-200">Speed</span>
            <span className="text-xs text-fog-400" aria-hidden="true">
              {audio.rate.toFixed(2)}×
            </span>
          </div>
          <input
            type="range"
            min={0.6}
            max={1.6}
            step={0.02}
            value={audio.rate}
            onChange={(e) => setAudio({ rate: Number(e.target.value) })}
            className="w-full mt-1.5 accent-[rgb(var(--c-spark-400))]"
            aria-label={`Voice speed: ${audio.rate.toFixed(2)} times`}
          />
        </div>

        {!speech.supported && (
          <p className="text-[11px] text-amber-500 mt-1">This browser doesn't support speech synthesis — Listen controls will be unavailable.</p>
        )}
      </div>
    </Drawer>
  );
}


function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={() => onChange(!checked)}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${checked ? "bg-spark-500" : "bg-ink-600"}`}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`}
        aria-hidden="true"
      />
    </button>
  );
}
