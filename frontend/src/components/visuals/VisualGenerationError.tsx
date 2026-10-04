import { RefreshIcon } from "../ui/Icons";

interface Props {
  message: string;
  code?: string;
  kind?: "diagram" | "picture";
  onRetry?: () => void;
}

export function VisualGenerationError({ message, code, kind = "diagram", onRetry }: Props) {
  // Recognize older server responses too, so an already-open canvas doesn't
  // display the raw upstream JSON while the backend is being restarted.
  const creditsRequired = code === "credits_required" || kind === "picture" && /HTTP 402|insufficient credits/i.test(message);
  const needsSettings = creditsRequired || ["key_required", "key_rejected", "model_unavailable", "no_image"].includes(code ?? "");
  return (
    <div className="border-t border-ink-700 px-3 py-3" role="alert" data-visual-error={creditsRequired ? "credits_required" : code ?? "generation_failed"}>
      <p className="text-xs font-medium text-fog-100">{creditsRequired ? "Picture generation needs OpenRouter credits" : kind === "picture" ? "Picture could not be generated" : "Visual could not be generated"}</p>
      <p className="mt-1 text-xs leading-relaxed break-words text-fog-400">
        {creditsRequired ? "Your OpenRouter account or API key has insufficient image-generation credits. Add credits to the account that owns this key, or save a funded key in Settings, then retry." : message}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {creditsRequired && <a className="btn-primary !px-3 !py-2 !text-xs nodrag nopan" href="https://openrouter.ai/settings/credits" target="_blank" rel="noreferrer">Add credits ↗</a>}
        {needsSettings && <a className="btn-secondary !px-3 !py-2 !text-xs nodrag nopan" href="#/settings">{creditsRequired ? "Check API key" : "Open AI settings"}</a>}
        {onRetry && <button type="button" className="btn-secondary !px-3 !py-2 !text-xs nodrag nopan" onClick={onRetry}><RefreshIcon className="h-3.5 w-3.5" /> {kind === "picture" ? "Retry picture" : "Retry visual"}</button>}
      </div>
    </div>
  );
}
