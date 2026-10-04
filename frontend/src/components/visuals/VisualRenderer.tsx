import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { VisualBlock, ChartSpec, DiagramSpec, IllustrationSpec, ComparisonTableSpec, SimSpec } from "@canvas-learn/shared";
import { SimulationVisual } from "./SimulationVisual";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import mermaid from "mermaid";
import { ImageOffIcon } from "../ui/Icons";



/** Mermaid theme follows the active app theme; re-initialized when it flips. */
function useMermaidTheme() {
  const isLight = document.documentElement.classList.contains("light");
  const [light, setLight] = useState(isLight);

  useEffect(() => {
    const el = document.documentElement;
    const apply = () => setLight(el.classList.contains("light"));
    // class toggling is done by usePrefs; watch for it cheaply
    const interval = window.setInterval(apply, 300);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: light ? "neutral" : "dark",
      themeVariables: light
        ? {
            primaryColor: "#eef0f4",
            primaryTextColor: "#111827",
            primaryBorderColor: "#c3cad4",
            lineColor: "#6b7684",
            fontSize: "13px",
          }
        : {
            primaryColor: "#1c2229",
            primaryTextColor: "#e6eaef",
            primaryBorderColor: "#3a4450",
            lineColor: "#8b95a3",
            fontSize: "13px",
          },
    });
  }, [light]);

  return light;
}

let mermaidCounter = 0;

/** Mermaid SVG renderer with staggered node reveal. */
const MermaidVisual = memo(function MermaidVisual({ spec }: { spec: DiagramSpec }) {
  const id = useMemo(() => `mmd-${++mermaidCounter}`, []);
  const [svg, setSvg] = useState<string>("");
  const [failed, setFailed] = useState(false);
  const [revealed, setRevealed] = useState(999);
  const containerRef = useRef<HTMLDivElement>(null);

  useMermaidTheme();

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    (async () => {
      try {
        const { svg: rendered } = await mermaid.render(id, spec.mermaid);
        if (cancelled) return;
        setSvg(rendered);
        const tmp = document.createElement("div");
        tmp.innerHTML = rendered;
        const nodeGroups = tmp.querySelectorAll("g.node").length;
        setRevealed(1);
        let i = 1;
        timer = window.setInterval(() => {
          i += 1;
          setRevealed(i);
          if (i >= nodeGroups && timer !== undefined) window.clearInterval(timer);
        }, 160);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [spec.mermaid, id]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || revealed >= 999) return;
    const groups = el.querySelectorAll("g.node");
    groups.forEach((g, i) => {
      (g as SVGElement).style.opacity = i < revealed ? "1" : "0";
      (g as SVGElement).style.transition = "opacity 300ms ease";
    });
  }, [svg, revealed]);

  if (failed) {
    return (
      <div className="border-t border-ink-700 px-3 py-3 flex items-center gap-2 text-fog-400 text-xs">
        <ImageOffIcon className="w-4 h-4 shrink-0" aria-hidden="true" />
        Visual could not be rendered.
      </div>
      );
  }

  return (
    <div
      ref={containerRef}
      className="flex justify-center p-2 [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
});

/** Shared recharts tooltip styling per theme. */
function useChartChrome() {
  const isLight = useMermaidThemeLight();
  return {
    contentStyle: {
      background: isLight ? "#ffffff" : "#161a20",
      border: `1px solid ${isLight ? "#c3cad4" : "#2a323c"}`,
      borderRadius: 8,
      color: isLight ? "#111827" : "#e6eaef",
      fontSize: 12,
    },
    cursorFill: isLight ? "#eef0f4" : "#1c2229",
    tickFill: isLight ? "#525a66" : "#a8b2bd",
    stroke: "#8b7cf6",
  };
}

/** Standalone light-theme watcher (no mermaid init side effect). */
function useMermaidThemeLight() {
  const [light, setLight] = useState(document.documentElement.classList.contains("light"));
  useEffect(() => {
    const el = document.documentElement;
    const apply = () => setLight(el.classList.contains("light"));
    apply();
    const interval = window.setInterval(apply, 300);
    return () => window.clearInterval(interval);
  }, []);
  return light;
}

function ChartVisual({ spec }: { spec: ChartSpec }) {
  const chrome = useChartChrome();
  const palette = ["#8b7cf6", "#60a5fa", "#34d399", "#fbbf24", "#f87171", "#f472b6", "#a3e635", "#94a3b8"];
  const data = spec.labels.map((label, i) => ({ name: label, value: spec.values[i] ?? 0 }));

  if (spec.chart_type === "donut") {
    return (
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2}>
            {data.map((_, i) => (
              <Cell key={i} fill={palette[i % palette.length]} stroke={chrome.cursorFill} />
            ))}
          </Pie>
          <Tooltip contentStyle={chrome.contentStyle} />
        </PieChart>
      </ResponsiveContainer>
    );
  }
  if (spec.chart_type === "bar") {
    return (
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 12 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={110} tick={{ fill: chrome.tickFill, fontSize: 11 }} />
          <Tooltip cursor={{ fill: chrome.cursorFill }} contentStyle={chrome.contentStyle} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={palette[i % palette.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ left: 8, right: 12 }}>
        <XAxis dataKey="name" tick={{ fill: chrome.tickFill, fontSize: 10 }} />
        <YAxis tick={{ fill: chrome.tickFill, fontSize: 10 }} width={40} />
        <Tooltip contentStyle={chrome.contentStyle} />
        <Line type="monotone" dataKey="value" stroke={chrome.stroke} strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function TableVisual({ spec }: { spec: ComparisonTableSpec }) {
  return (
    <div className="overflow-x-auto p-2">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            {spec.headers.map((h, i) => (
              <th key={i} className="text-left font-medium text-fog-300 border-b border-ink-600 px-2 py-1.5">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className="px-2 py-1.5 border-b border-ink-700/60 text-fog-200">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Illustration (product decision: renderer INTENTIONALLY DEFERRED — ADR-005).
 * No placeholder graphics and no nonfunctional controls: the preserved spec data
 * (scene, elements, caption) is shown honestly, so persisted canvases and shared
 * JSON keep their illustration content until a genuinely good renderer lands.
 */
const IllustrationVisual = memo(function IllustrationVisual({ spec }: { spec: IllustrationSpec }) {
  const elements = spec.elements ?? [];
  return (
    <div className="border-t border-ink-700 px-3 py-3">
      <div className="flex items-start gap-2">
        <ImageOffIcon className="w-4 h-4 shrink-0 mt-0.5 text-fog-500" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-xs text-fog-300">
            Illustration — <span className="text-fog-500">the renderer is intentionally deferred until it can look genuinely good</span>
          </p>
          {spec.scene && <p className="text-xs text-fog-400 mt-1">{spec.scene}</p>}
          {elements.length > 0 && (
            <p className="text-[11px] text-fog-500 mt-1">
              Saved elements: {elements.slice(0, 8).map((el) => el.label || el.icon).join(", ")}
              {elements.length > 8 ? ` +${elements.length - 8} more` : ""}
            </p>
          )}
          {spec.caption && <p className="text-[11px] text-fog-500 mt-1">{spec.caption}</p>}
        </div>
      </div>
    </div>
  );
});

/** Status states matching the recorded UI copy (PRD FR13 / §4.2). */
export const VisualRenderer = memo(function VisualRenderer({ visual }: { visual: VisualBlock | null }) {
  if (!visual || visual.type === "none") return null;

  if (visual.status === "pending" || visual.status === "generating") {
    return (
      <div className="border-t border-ink-700 px-3 py-3">
        <span className="status-text">
          {visual.status === "pending" ? "Creating a visual..." : "Generating visuals..."}
        </span>
      </div>
    );
  }
  if (visual.status === "failed") {
    return (
      <div className="border-t border-ink-700 px-3 py-2">
        <span className="text-fog-400 text-xs">Visual generation failed.</span>
      </div>
    );
  }

  // ready — but the spec may still be unusable; every branch has a graceful fallback
  try {
    if (visual.type === "cycle_diagram" || visual.type === "flowchart" || visual.type === "timeline") {
      return <MermaidVisual spec={visual.spec as DiagramSpec} />;
    }
    if (visual.type === "chart") return <ChartVisual spec={visual.spec as ChartSpec} />;
    if (visual.type === "comparison_table") return <TableVisual spec={visual.spec as ComparisonTableSpec} />;
    if (visual.type === "illustration") return <IllustrationVisual spec={visual.spec as IllustrationSpec} />;
    if (visual.type === "interactive_sim") return <SimulationVisual spec={visual.spec as SimSpec} />;
  } catch {
    return (
      <div className="border-t border-ink-700 px-3 py-2">
        <span className="text-fog-400 text-xs">Visual could not be rendered.</span>
      </div>
    );
  }
  return null;
});
