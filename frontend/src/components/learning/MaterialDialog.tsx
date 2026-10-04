import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { PlusIcon, CloseIcon } from "../ui/Icons";

type Mode = "text" | "url" | "file";

interface Props {
  open: boolean;
  onClose: () => void;
  /** When set, the material is attached to this canvas (null/undefined = global source). */
  canvasId?: string | null;
  canvasTitle?: string;
  onAdded: () => void;
}

/**
 * Add study material — paste text, a web link, or upload a file
 * (.txt / .md / .html / .pdf; the server extracts readable text).
 * Shared by the Library and the Source Explorer (the latter pre-attaches a canvas).
 */
export function MaterialDialog({ open, onClose, canvasId, canvasTitle, onAdded }: Props) {
  const [mode, setMode] = useState<Mode>("text");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileB64, setFileB64] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setTitle("");
    setText("");
    setUrl("");
    setFileName("");
    setFileB64("");
    setError("");
  };

  const close = () => {
    reset();
    onClose();
  };

  const add = useMutation({
    mutationFn: () =>
      mode === "text"
        ? api.createMaterial({ kind: "text", title: title || undefined, content: text, canvas_id: canvasId ?? null })
        : mode === "url"
          ? api.createMaterial({ kind: "url", url, canvas_id: canvasId ?? null })
          : api.uploadMaterial(fileName, fileB64, canvasId),
    onSuccess: () => {
      reset();
      onAdded();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const onFile = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) {
      setError("File too large (max 25 MB)");
      return;
    }
    setError("");
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      setFileName(f.name);
      setFileB64(dataUrl.slice(dataUrl.indexOf(",") + 1));
    };
    reader.onerror = () => setError("Could not read that file");
    reader.readAsDataURL(f);
  };

  if (!open) return null;

  const ready =
    mode === "text" ? text.trim().length > 0 : mode === "url" ? url.trim().length > 0 : fileB64.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Add study material">
      <div className="absolute inset-0 bg-black/50" onClick={close} aria-hidden="true" />
      <div className="relative popover-surface w-full max-w-lg p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-sm font-medium text-fog-100">
              {canvasId ? `Add source to ${canvasTitle ? `“${canvasTitle}”` : "this canvas"}` : "Add study material"}
            </h3>
            <p className="text-xs text-fog-400 mt-0.5">
              {canvasId ? "Attached to this canvas — answers here can be grounded in it." : "Global source — available to every canvas."}
            </p>
          </div>
          <button className="btn-ghost" onClick={close} aria-label="Close" title="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="flex gap-1 mb-3" role="tablist" aria-label="Material type">
          {(["text", "url", "file"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                setMode(m);
                setError("");
              }}
              className={`text-xs rounded-full px-3 py-1 border transition-colors ${
                mode === m ? "border-spark-500 bg-spark-500/15 text-spark-400" : "border-ink-700 text-fog-300"
              }`}
            >
              {m === "text" ? "Paste text" : m === "url" ? "Web link" : "Upload file"}
            </button>
          ))}
        </div>

        {mode === "text" ? (
          <>
            <input className="input-bar w-full mb-2" placeholder="Title (optional)" aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <textarea className="input-bar w-full" rows={7} placeholder="Paste your notes, transcript, or any study text…" aria-label="Material text" value={text} onChange={(e) => setText(e.target.value)} />
          </>
        ) : mode === "url" ? (
          <input className="input-bar w-full" placeholder="https://example.com/article" aria-label="Web address" value={url} onChange={(e) => setUrl(e.target.value)} type="url" />
        ) : (
          <button
            className="w-full border border-dashed border-ink-600 hover:border-spark-500 rounded-lg p-6 text-center transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            <PlusIcon className="w-4 h-4 mx-auto mb-1.5 opacity-60" />
            {fileName ? (
              <span className="text-xs text-spark-400">{fileName}</span>
            ) : (
              <span className="text-xs text-fog-300">
                Choose a file — <span className="text-fog-400">.txt, .md, .html, .pdf</span> (max 25 MB)
              </span>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.markdown,.html,.htm,.pdf"
              className="hidden"
              aria-label="Material file"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </button>
        )}

        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
        <div className="flex justify-end mt-3">
          <button
            className="btn-primary"
            disabled={add.isPending || !ready}
            onClick={() => {
              setError("");
              add.mutate();
            }}
          >
            {add.isPending ? "Saving…" : "Save source"}
          </button>
        </div>
      </div>
    </div>
  );
}
