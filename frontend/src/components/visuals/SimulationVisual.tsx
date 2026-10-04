import { useMemo, useState } from "react";
import type { SimSpec } from "@canvas-learn/shared";
import { computeSim } from "../../lib/simulations";

const ACCENT = "#8b7cf6";
const ACCENT_SOFT = "#a78bfa";
const GRID = "#2a323c";
const TEXT = "#a8b2bd";

const W = 420;
const H = 240;
const PAD = 34;

function scale(v: number, max: number, from: number, to: number): number {
  if (max <= 0) return from;
  return from + (v / max) * (to - from);
}

/** Projectile: axes + trajectory arc + apex, recomputed live from sliders. */
function ProjectileSvg({ v0, angle }: { v0: number; angle: number }) {
  const res = useMemo(() => computeSim("projectile", { v0, angle }), [v0, angle]);
  if (res.kind !== "projectile") return null;
  const maxX = Math.max(res.range, 1);
  const maxY = Math.max(res.maxHeight, 1);
  const sx = (x: number) => scale(x, maxX, PAD, W - PAD);
  const sy = (y: number) => scale(y, maxY, H - PAD, PAD);
  const path = res.points.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  const apex = res.points.reduce((best, p) => (p.y > best.y ? p : best), res.points[0]!);
  return (
    <>
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke={GRID} strokeWidth={1} />
      <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke={GRID} strokeWidth={1} />
      <path d={path} fill="none" stroke={ACCENT} strokeWidth={2.5} strokeLinecap="round" />
      <circle cx={sx(apex.x)} cy={sy(apex.y)} r={4} fill={ACCENT_SOFT} />
      <circle cx={sx(res.range)} cy={H - PAD} r={3} fill={TEXT} />
      <text x={sx(apex.x)} y={sy(apex.y) - 8} fill={TEXT} fontSize={11} textAnchor="middle">apex</text>
      <text x={W - PAD} y={H - PAD + 16} fill={TEXT} fontSize={11} textAnchor="end">
        range {res.range} m · {res.flightTime}s
      </text>
      <text x={PAD} y={PAD - 8} fill={TEXT} fontSize={11}>
        max height {res.maxHeight.toFixed(1)} m
      </text>
    </>
  );
}

/** Compound interest: balance curve over years with principal baseline. */
function CompoundSvg(props: { principal: number; annual_rate: number; years: number; compounding: number; contribution: number }) {
  const { principal, annual_rate, years, compounding, contribution } = props;
  const res = useMemo(
    () => computeSim("compound_interest", { principal, annual_rate, years, compounding, contribution }),
    [principal, annual_rate, years, compounding, contribution],
  );
  if (res.kind !== "compound") return null;
  const maxYear = Math.max(res.points[res.points.length - 1]!.year, 1);
  const maxBal = Math.max(...res.points.map((p) => p.balance), 1);
  const sx = (y: number) => scale(y, maxYear, PAD, W - PAD);
  const sy = (b: number) => scale(b, maxBal, H - PAD, PAD);
  const line = res.points.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.year).toFixed(1)},${sy(p.balance).toFixed(1)}`).join(" ");
  const area = `${line} L${sx(maxYear).toFixed(1)},${(H - PAD).toFixed(1)} L${sx(0).toFixed(1)},${(H - PAD).toFixed(1)} Z`;
  const last = res.points[res.points.length - 1]!;
  const fmt = (n: number) => (Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`);
  return (
    <>
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke={GRID} strokeWidth={1} />
      <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke={GRID} strokeWidth={1} />
      <path d={area} fill={ACCENT} opacity={0.12} />
      <path d={line} fill="none" stroke={ACCENT} strokeWidth={2.5} strokeLinecap="round" />
      <line x1={PAD} y1={sy(principal)} x2={W - PAD} y2={sy(principal)} stroke={GRID} strokeDasharray="4 3" />
      <circle cx={sx(last.year)} cy={sy(last.balance)} r={4} fill={ACCENT_SOFT} />
      <text x={sx(last.year)} y={sy(last.balance) - 8} fill={ACCENT_SOFT} fontSize={11} textAnchor="end">
        {fmt(res.finalBalance)}
      </text>
      <text x={PAD} y={PAD - 8} fill={TEXT} fontSize={11}>
        interest earned {fmt(res.totalInterest)}
      </text>
      <text x={W - PAD} y={H - PAD + 16} fill={TEXT} fontSize={11} textAnchor="end">{maxYear} yrs</text>
    </>
  );
}

/** Binomial: bars of P(k) with the mean marked. */
function BinomialSvg({ n, p }: { n: number; p: number }) {
  const res = useMemo(() => computeSim("binomial", { n, p }), [n, p]);
  if (res.kind !== "binomial") return null;
  const maxK = Math.max(n, 1);
  const barW = (W - 2 * PAD) / (maxK + 1);
  const sx = (k: number) => PAD + k * barW;
  const sy = (prob: number) => scale(prob, res.maxProb, H - PAD, PAD + 6);
  return (
    <>
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke={GRID} strokeWidth={1} />
      {res.bars.map((b) => (
        <rect
          key={b.k}
          x={sx(b.k) + barW * 0.12}
          y={sy(b.prob)}
          width={barW * 0.76}
          height={H - PAD - sy(b.prob)}
          rx={2}
          fill={Math.abs(b.k - res.mean) < 0.75 ? ACCENT : "#4b5563"}
        />
      ))}
      <line x1={sx(res.mean)} y1={PAD} x2={sx(res.mean)} y2={H - PAD} stroke={ACCENT_SOFT} strokeDasharray="4 3" />
      <text x={sx(res.mean)} y={PAD - 8} fill={ACCENT_SOFT} fontSize={11} textAnchor="middle">
        mean {res.mean.toFixed(1)}
      </text>
      <text x={W - PAD} y={H - PAD + 16} fill={TEXT} fontSize={11} textAnchor="end">
        P(k), σ = {res.sd.toFixed(2)}
      </text>
    </>
  );
}

/** Pendulum: θ(t) oscillation, period markers, amplitude-decay annotation. */
function PendulumSvg({ length, gravity, damping, start_angle }: { length: number; gravity: number; damping: number; start_angle: number }) {
  const res = useMemo(
    () => computeSim("pendulum", { length, gravity, damping, start_angle }),
    [length, gravity, damping, start_angle],
  );
  if (res.kind !== "pendulum") return null;
  const tMax = Math.max(res.points[res.points.length - 1]!.t, 0.1);
  const aMax = Math.max(res.amplitudeStart, 5);
  const sx = (t: number) => scale(t, tMax, PAD, W - PAD);
  const sy = (a: number) => {
    // symmetric around 0 (θ oscillates ±amplitude)
    const m = aMax * 1.15;
    return H / 2 - (a / m) * (H / 2 - PAD);
  };
  const line = res.points.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.t).toFixed(1)},${sy(p.theta).toFixed(1)}`).join(" ");
  const nonlinear = res.period - res.periodSmallAngle > 0.02 * res.periodSmallAngle;
  return (
    <>
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke={GRID} strokeWidth={1} />
      <line x1={PAD} y1={sy(0)} x2={W - PAD} y2={sy(0)} stroke={GRID} strokeDasharray="4 3" />
      <path d={line} fill="none" stroke={ACCENT} strokeWidth={2.5} strokeLinecap="round" />
      {/* one measured period bracket */}
      <line x1={sx(0)} y1={PAD - 2} x2={sx(Math.min(res.period, tMax))} y2={PAD - 2} stroke={ACCENT_SOFT} strokeWidth={1.5} />
      <text x={sx(Math.min(res.period, tMax) / 2)} y={PAD - 8} fill={ACCENT_SOFT} fontSize={11} textAnchor="middle">
        T = {res.period.toFixed(2)}s{nonlinear ? ` (small-angle ${res.periodSmallAngle.toFixed(2)}s)` : ""}
      </text>
      <text x={W - PAD} y={H - PAD + 16} fill={TEXT} fontSize={11} textAnchor="end">
        amplitude {res.amplitudeStart.toFixed(0)}° → {res.amplitudeEnd.toFixed(0)}°
        {damping > 0 ? " (damped)" : " (undamped)"}
      </text>
      <text x={PAD} y={H - PAD + 16} fill={TEXT} fontSize={11}>
        L = {length} m · g = {gravity} m/s²
      </text>
    </>
  );
}

/** RC circuit: charge (solid) and discharge (dashed) curves with the τ marker. */
function RcSvg({ voltage, resistance, capacitance }: { voltage: number; resistance: number; capacitance: number }) {
  const res = useMemo(() => computeSim("rc_circuit", { voltage, resistance, capacitance }), [voltage, resistance, capacitance]);
  if (res.kind !== "rc") return null;
  const tMax = Math.max(res.charge[res.charge.length - 1]!.t, 0.001);
  const sx = (t: number) => scale(t, tMax, PAD, W - PAD);
  const sy = (v: number) => scale(v, res.voltage, H - PAD, PAD);
  const toPath = (pts: { t: number; v: number }[]) => pts.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.t).toFixed(1)},${sy(p.v).toFixed(1)}`).join(" ");
  const tauX = sx(res.tau);
  return (
    <>
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke={GRID} strokeWidth={1} />
      <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke={GRID} strokeWidth={1} />
      <line x1={PAD} y1={sy(res.voltage)} x2={W - PAD} y2={sy(res.voltage)} stroke={GRID} strokeDasharray="2 3" />
      <path d={toPath(res.charge)} fill="none" stroke={ACCENT} strokeWidth={2.5} strokeLinecap="round" />
      <path d={toPath(res.discharge)} fill="none" stroke="#34d399" strokeWidth={2} strokeDasharray="5 4" strokeLinecap="round" />
      {/* τ marker: at t=τ the capacitor has 63.2% of V0 */}
      <line x1={tauX} y1={sy(res.vAtTau)} x2={tauX} y2={H - PAD} stroke={ACCENT_SOFT} strokeDasharray="3 3" />
      <circle cx={tauX} cy={sy(res.vAtTau)} r={3.5} fill={ACCENT_SOFT} />
      <text x={tauX + 4} y={sy(res.vAtTau) - 6} fill={ACCENT_SOFT} fontSize={11}>
        τ = {res.tau >= 1 ? `${res.tau.toFixed(1)}s` : `${Math.round(res.tau * 1000)}ms`} → 63.2%
      </text>
      <text x={PAD} y={sy(res.voltage) - 5} fill={TEXT} fontSize={11}>
        {res.voltage} V (supply)
      </text>
      <text x={W - PAD} y={H - PAD + 16} fill={TEXT} fontSize={11} textAnchor="end">
        <tspan fill={ACCENT}>—</tspan> charge   <tspan fill="#34d399">---</tspan> discharge · 99% at {res.tTo99 >= 1 ? `${res.tTo99.toFixed(1)}s` : `${Math.round(res.tTo99 * 1000)}ms`}
      </text>
    </>
  );
}

/** Logistic growth: S-curve with K line and the inflection (fastest growth) point. */
function LogisticSvg({ p0, k, r }: { p0: number; k: number; r: number }) {
  const res = useMemo(() => computeSim("logistic_growth", { p0, k, r }), [p0, k, r]);
  if (res.kind !== "logistic") return null;
  const tMax = Math.max(res.horizon, 0.1);
  const sx = (t: number) => scale(t, tMax, PAD, W - PAD);
  const sy = (p: number) => scale(p, k, H - PAD, PAD);
  const line = res.points.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.t).toFixed(1)},${sy(p.p).toFixed(1)}`).join(" ");
  const kY = sy(k);
  const halfY = sy(k / 2);
  const infX = sx(res.tInflection);
  return (
    <>
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke={GRID} strokeWidth={1} />
      <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke={GRID} strokeWidth={1} />
      <line x1={PAD} y1={kY} x2={W - PAD} y2={kY} stroke={GRID} strokeDasharray="4 3" />
      <path d={line} fill="none" stroke={ACCENT} strokeWidth={2.5} strokeLinecap="round" />
      {/* inflection: fastest growth at P = K/2 */}
      <line x1={infX} y1={halfY} x2={infX} y2={H - PAD} stroke={ACCENT_SOFT} strokeDasharray="3 3" />
      <circle cx={infX} cy={halfY} r={3.5} fill={ACCENT_SOFT} />
      <text x={infX + 5} y={halfY - 6} fill={ACCENT_SOFT} fontSize={11}>
        fastest growth: {res.maxGrowth >= 100 ? Math.round(res.maxGrowth) : res.maxGrowth.toFixed(1)}/unit
      </text>
      <text x={W - PAD - 2} y={kY - 5} fill={TEXT} fontSize={11} textAnchor="end">
        carrying capacity K = {k}
      </text>
      <text x={W - PAD} y={H - PAD + 16} fill={TEXT} fontSize={11} textAnchor="end">
        {res.tDouble !== null ? `doubles in ${res.tDouble.toFixed(1)} units · ` : ""}reaches ~K at t ≈ {res.horizon}
      </text>
      <text x={PAD} y={H - PAD + 16} fill={TEXT} fontSize={11}>
        P₀ = {p0} · r = {r}
      </text>
    </>
  );
}

/** SIR model: S/I/R fractions over time, peak-infected marker, R0 annotation. */
function SirSvg({ population, initial_infected, beta, gamma }: { population: number; initial_infected: number; beta: number; gamma: number }) {
  const res = useMemo(() => computeSim("sir_model", { population, initial_infected, beta, gamma }), [population, initial_infected, beta, gamma]);
  if (res.kind !== "sir") return null;
  const tMax = Math.max(res.horizon, 1);
  const iMax = Math.max(res.peakInfected, 0.02);
  const sx = (t: number) => scale(t, tMax, PAD, W - PAD);
  const sy = (f: number) => scale(f, iMax, H - PAD, PAD);
  const toPath = (key: "s" | "i" | "r") =>
    res.points.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.t).toFixed(1)},${sy(p[key]).toFixed(1)}`).join(" ");
  const peakX = sx(res.peakDay);
  const peakY = sy(res.peakInfected);
  return (
    <>
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke={GRID} strokeWidth={1} />
      <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke={GRID} strokeWidth={1} />
      <path d={toPath("s")} fill="none" stroke="#60a5fa" strokeWidth={2} />
      <path d={toPath("i")} fill="none" stroke={ACCENT} strokeWidth={2.5} strokeLinecap="round" />
      <path d={toPath("r")} fill="none" stroke="#34d399" strokeWidth={2} />
      <line x1={peakX} y1={peakY} x2={peakX} y2={H - PAD} stroke={ACCENT_SOFT} strokeDasharray="3 3" />
      <circle cx={peakX} cy={peakY} r={3.5} fill={ACCENT_SOFT} />
      <text x={peakX + 4} y={peakY - 6} fill={ACCENT_SOFT} fontSize={11}>
        peak {Math.round(res.peakInfected * 100)}% on day {Math.round(res.peakDay)}
      </text>
      <text x={W - PAD} y={H - PAD + 16} fill={TEXT} fontSize={11} textAnchor="end">
        R₀ = {res.r0} {res.r0 < 1 ? "(dies out)" : ""} · final size {Math.round(res.finalSize * 100)}%
      </text>
      <text x={PAD} y={H - PAD + 16} fill={TEXT} fontSize={11}>
        <tspan fill="#60a5fa">S</tspan> / <tspan fill={ACCENT}>I</tspan> / <tspan fill="#34d399">R</tspan> of {population.toLocaleString()}
      </text>
    </>
  );
}

/**
 * Interactive simulation (roadmap 4): sliders drive `computeSim`, and the SVG
 * re-renders from the live values — manipulable, not a static picture.
 */
export function SimulationVisual({ spec }: { spec: SimSpec }) {
  const [values, setValues] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const p of spec.params) init[p.key] = p.value;
    return init;
  });

  const set = (key: string, v: number) => setValues((s) => ({ ...s, [key]: v }));

  return (
    <div className="border-t border-ink-700 p-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full dot-grid rounded-lg" role="img" aria-label={spec.title ?? "simulation"}>
        {spec.sim === "projectile" && <ProjectileSvg v0={values.v0 ?? 35} angle={values.angle ?? 45} />}
        {spec.sim === "compound_interest" && (
          <CompoundSvg
            principal={values.principal ?? 1000}
            annual_rate={values.annual_rate ?? 7}
            years={values.years ?? 20}
            compounding={values.compounding ?? 12}
            contribution={values.contribution ?? 0}
          />
        )}
        {spec.sim === "binomial" && <BinomialSvg n={values.n ?? 10} p={values.p ?? 0.5} />}
        {spec.sim === "pendulum" && (
          <PendulumSvg
            length={values.length ?? 1}
            gravity={values.gravity ?? 9.8}
            damping={values.damping ?? 0.1}
            start_angle={values.start_angle ?? 30}
          />
        )}
        {spec.sim === "rc_circuit" && (
          <RcSvg voltage={values.voltage ?? 9} resistance={values.resistance ?? 10000} capacitance={values.capacitance ?? 100} />
        )}
        {spec.sim === "logistic_growth" && <LogisticSvg p0={values.p0 ?? 10} k={values.k ?? 1000} r={values.r ?? 0.5} />}
        {spec.sim === "sir_model" && (
          <SirSvg
            population={values.population ?? 10000}
            initial_infected={values.initial_infected ?? 5}
            beta={values.beta ?? 0.4}
            gamma={values.gamma ?? 0.25}
          />
        )}
      </svg>

      {spec.title && <p className="text-xs font-medium text-fog-100 mt-2">{spec.title}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 mt-2">
        {spec.params.map((p) => (
          <label key={p.key} className="block">
            <span className="flex justify-between text-[11px] text-fog-300">
              <span>{p.label}</span>
              <span className="text-spark-300 tabular-nums">
                {values[p.key] ?? p.value}
                {p.unit ? ` ${p.unit}` : ""}
              </span>
            </span>
            <input
              type="range"
              min={p.min}
              max={p.max}
              step={p.step}
              value={values[p.key] ?? p.value}
              onChange={(e) => set(p.key, Number(e.target.value))}
              className="mt-1 w-full accent-spark-500"
              aria-label={p.label}
            />
          </label>
        ))}
      </div>

      {spec.caption && <p className="text-[11px] text-fog-400 mt-2">{spec.caption}</p>}
    </div>
  );
}
