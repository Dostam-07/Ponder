import type { SimName } from "@canvas-learn/shared";

/**
 * Deterministic simulation math (roadmap 4). Pure functions: given numeric inputs
 * they always produce the same render data. The LLM only picks a sim + starting
 * params; the picture is computed here, so moving a slider changes the model, not
 * just text. No network, no mocks.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface ProjectileResult {
  kind: "projectile";
  /** trajectory sampled over the flight; x = horizontal distance, y = height (m) */
  points: Vec2[];
  maxHeight: number;
  range: number;
  flightTime: number;
}

export interface CompoundPoint {
  year: number;
  balance: number;
}

export interface CompoundResult {
  kind: "compound";
  points: CompoundPoint[];
  finalBalance: number;
  totalInterest: number;
  totalContributed: number;
}

export interface BinomialBar {
  k: number;
  prob: number;
}

export interface BinomialResult {
  kind: "binomial";
  bars: BinomialBar[];
  mean: number;
  sd: number;
  maxProb: number;
}

export interface PendulumResult {
  kind: "pendulum";
  /** θ(t) in degrees, sampled over ~3 small-angle periods (or until it settles) */
  points: { t: number; theta: number }[];
  /** measured oscillation period (s), from consecutive same-direction zero crossings */
  period: number;
  /** small-angle reference period 2π√(L/g) (s) */
  periodSmallAngle: number;
  /** peak |θ| in the first half-cycle and the last (shows damping) */
  amplitudeStart: number;
  amplitudeEnd: number;
}

export interface RcResult {
  kind: "rc";
  /** V(t) while charging from 0 toward V0 (solid curve) */
  charge: { t: number; v: number }[];
  /** V(t) while discharging from V0 (dashed curve) */
  discharge: { t: number; v: number }[];
  /** time constant τ = R·C (s) */
  tau: number;
  /** V at t = τ on the charge curve: V0·(1−e⁻¹) ≈ 0.632·V0 */
  vAtTau: number;
  /** time to reach 99% of V0: τ·ln(100) ≈ 4.605·τ */
  tTo99: number;
  voltage: number;
}

export interface LogisticResult {
  kind: "logistic";
  points: { t: number; p: number }[];
  /** time at which P = K/2 (inflection — fastest growth) */
  tInflection: number;
  /** max growth rate r·K/4 (individuals/time) */
  maxGrowth: number;
  /** time to double from P0 (undefined when P0 ≥ K/2 — already past doubling) */
  tDouble: number | null;
  /** horizon actually plotted (time when P reaches 99.9% of K, capped) */
  horizon: number;
}

export interface SirResult {
  kind: "sir";
  /** S, I, R as fractions of the population (always sum to 1, within RK4 tolerance) */
  points: { t: number; s: number; i: number; r: number }[];
  /** basic reproduction number R0 = β/γ */
  r0: number;
  /** peak infected fraction and the day it occurs */
  peakInfected: number;
  peakDay: number;
  /** final size: fraction ever infected at the end of the run */
  finalSize: number;
  /** simulated horizon in days */
  horizon: number;
}

export type SimResult =
  | ProjectileResult
  | CompoundResult
  | BinomialResult
  | PendulumResult
  | RcResult
  | LogisticResult
  | SirResult;

const G = 9.81;

function readNum(params: Record<string, number>, key: string, fallback: number, min: number, max: number): number {
  const v = params[key];
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

/** Projectile motion on a uniform gravity field. */
export function simulateProjectile(params: Record<string, number>): ProjectileResult {
  const v0 = readNum(params, "v0", 35, 1, 500);
  const angle = readNum(params, "angle", 45, 0, 90) * (Math.PI / 180);
  const v0x = v0 * Math.cos(angle);
  const v0y = v0 * Math.sin(angle);
  const flightTime = (2 * v0y) / G;
  const steps = 60;
  const points: Vec2[] = [];
  let maxHeight = 0;
  for (let i = 0; i <= steps; i++) {
    const t = (flightTime * i) / steps;
    const x = v0x * t;
    const y = v0y * t - 0.5 * G * t * t;
    if (y > maxHeight) maxHeight = y;
    points.push({ x, y });
  }
  const range = v0x * flightTime;
  return { kind: "projectile", points, maxHeight, range: Number(range.toFixed(2)), flightTime: Number(flightTime.toFixed(2)) };
}

/** Compound interest with periodic compounding and monthly contributions. */
export function simulateCompoundInterest(params: Record<string, number>): CompoundResult {
  const principal = readNum(params, "principal", 1000, 0, 1e9);
  const annualRatePct = readNum(params, "annual_rate", 7, 0, 100);
  const years = Math.round(readNum(params, "years", 20, 0, 200));
  const compounding = Math.round(readNum(params, "compounding", 12, 1, 12));
  const contributionMonthly = readNum(params, "contribution", 0, 0, 1e9);

  const r = annualRatePct / 100;
  let balance = principal;
  const points: CompoundPoint[] = [{ year: 0, balance }];
  for (let y = 1; y <= years; y++) {
    for (let c = 0; c < compounding; c++) {
      balance = balance * (1 + r / compounding) + contributionMonthly * (12 / compounding);
    }
    points.push({ year: y, balance });
  }
  const totalContributed = principal + contributionMonthly * 12 * years;
  return {
    kind: "compound",
    points,
    finalBalance: balance,
    totalInterest: balance - totalContributed,
    totalContributed,
  };
}

function binomialCoefficient(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

/** Binomial distribution P(k) for k=0..n with success probability p. */
export function simulateBinomial(params: Record<string, number>): BinomialResult {
  const n = Math.round(readNum(params, "n", 10, 1, 40));
  const p = readNum(params, "p", 0.5, 0, 1);
  const bars: BinomialBar[] = [];
  let maxProb = 0;
  for (let k = 0; k <= n; k++) {
    const prob = binomialCoefficient(n, k) * Math.pow(p, k) * Math.pow(1 - p, n - k);
    if (prob > maxProb) maxProb = prob;
    bars.push({ k, prob });
  }
  const mean = n * p;
  const sd = Math.sqrt(n * p * (1 - p));
  return { kind: "binomial", bars, mean, sd, maxProb };
}

/**
 * Damped pendulum — the full nonlinear equation θ″ = −(g/L)·sin θ − b·θ′
 * integrated with semi-implicit (symplectic) Euler, which conserves energy
 * structure for oscillators and stays stable at the step sizes used here.
 * The small-angle period 2π√(L/g) is reported alongside the period MEASURED
 * from the simulated crossings — for large amplitudes the real period is
 * longer, and that difference is exactly what the learner should see.
 */
export function simulatePendulum(params: Record<string, number>): PendulumResult {
  const L = readNum(params, "length", 1, 0.2, 3);
  const g = readNum(params, "gravity", 9.8, 1, 25);
  const b = readNum(params, "damping", 0.1, 0, 2);
  const theta0 = readNum(params, "start_angle", 30, 5, 90) * (Math.PI / 180);

  const dt = 0.002; // integration step (s)
  const sampleEvery = 20; // record every 20th step → 0.04 s samples
  const T0 = 2 * Math.PI * Math.sqrt(L / g); // small-angle period
  const horizon = Math.min(3.2 * T0, 60); // ~3 periods, capped for slow Moon-like pendulums
  const steps = Math.ceil(horizon / dt);

  let theta = theta0;
  let omega = 0;
  const points: { t: number; theta: number }[] = [];
  let prevTheta = theta;
  // zero-crossings (positive→negative) to measure the real period
  let lastDownCross = -1;
  let period = NaN;
  // damped motion never exceeds its initial amplitude, so the global max θ is
  // the starting amplitude; the final-window max is the current one.
  let amplitudeStart = 0;
  let amplitudeEnd = 0;

  for (let i = 0; i <= steps; i++) {
    if (i % sampleEvery === 0) {
      const t = i * dt;
      const deg = (theta * 180) / Math.PI;
      points.push({ t: Number(t.toFixed(3)), theta: Number(deg.toFixed(3)) });
      if (deg > amplitudeStart) amplitudeStart = deg;
    }
    // semi-implicit Euler: update ω first, then θ (symplectic).
    // θ″ = −(g/L)·sin θ − b·θ′  — note the MINUS on the damping term;
    // a plus would be negative damping (energy pumping), which diverges.
    omega += (-(g / L) * Math.sin(theta) - b * omega) * dt;
    const newTheta = theta + omega * dt;
    if (prevTheta >= 0 && newTheta < 0) {
      if (lastDownCross >= 0) {
        period = i * dt - lastDownCross;
      }
      lastDownCross = i * dt;
    }
    prevTheta = newTheta;
    theta = newTheta;
  }

  if (!Number.isFinite(period)) period = T0; // over-damped or no second crossing → reference period
  // amplitude at the end: max |θ| over the final sample
  const lastSamples = points.slice(-Math.max(2, Math.floor(points.length * 0.1)));
  for (const p of lastSamples) amplitudeEnd = Math.max(amplitudeEnd, Math.abs(p.theta));

  return {
    kind: "pendulum",
    points,
    period: Number(period.toFixed(3)),
    periodSmallAngle: Number(T0.toFixed(3)),
    amplitudeStart: Number(amplitudeStart.toFixed(1)),
    amplitudeEnd: Number(amplitudeEnd.toFixed(1)),
  };
}

/**
 * RC circuit — exact closed forms (no integration needed):
 * charging from 0: V(t) = V0·(1 − e^(−t/τ)); discharging from V0: V(t) = V0·e^(−t/τ),
 * with τ = R·C. Both curves share the same τ and are plotted over 0…5τ.
 */
export function simulateRcCircuit(params: Record<string, number>): RcResult {
  const V0 = readNum(params, "voltage", 9, 1, 24);
  const R = readNum(params, "resistance", 10000, 100, 100000);
  const Cuf = readNum(params, "capacitance", 100, 1, 1000);
  const tau = (R * Cuf) / 1e6; // R·C in seconds (C stored in µF)

  const steps = 60;
  const charge: { t: number; v: number }[] = [];
  const discharge: { t: number; v: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (5 * tau * i) / steps;
    charge.push({ t: Number(t.toFixed(4)), v: Number((V0 * (1 - Math.exp(-t / tau))).toFixed(4)) });
    discharge.push({ t: Number(t.toFixed(4)), v: Number((V0 * Math.exp(-t / tau)).toFixed(4)) });
  }
  return {
    kind: "rc",
    charge,
    discharge,
    tau: Number(tau.toFixed(4)),
    vAtTau: Number((V0 * (1 - Math.exp(-1))).toFixed(4)),
    // 99% charge: 1 − e^(−t/τ) = 0.99 → t = τ·ln(100) ≈ 4.605·τ (NOT τ·ln 10)
    tTo99: Number((tau * Math.log(100)).toFixed(4)),
    voltage: V0,
  };
}

/**
 * Logistic growth — exact closed form P(t) = K / (1 + ((K−P0)/P0)·e^(−rt)).
 * Monotone, bounded by K, with the inflection (fastest growth) at P = K/2.
 */
export function simulateLogisticGrowth(params: Record<string, number>): LogisticResult {
  const P0 = Math.max(1, readNum(params, "p0", 10, 1, 1000));
  const K = Math.max(P0 + 1, readNum(params, "k", 1000, 100, 10000));
  const r = readNum(params, "r", 0.5, 0.05, 1.5);

  const A = (K - P0) / P0;
  // inflection time: P(t) = K/2 → t* = (1/r)·ln((K−P0)/P0)
  const tInflection = Math.log(A) / r;
  // double time from P0 (only meaningful before the population passes K/2)
  const tDouble = P0 < K / 2 ? Math.log(2) / r : null;
  // horizon: when P reaches 99.9% of K. From A·e^(−rt) = 0.001/0.999:
  // t999 = (ln A + ln 999)/r  (= tInflection + ln(999)/r)
  const t999 = (Math.log(A) + Math.log(999)) / r;
  const horizon = Math.min(t999, tInflection * 4 + 20);

  const steps = 80;
  const points: { t: number; p: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (horizon * i) / steps;
    const p = K / (1 + A * Math.exp(-r * t));
    points.push({ t: Number(t.toFixed(2)), p: Number(p.toFixed(2)) });
  }
  return {
    kind: "logistic",
    points,
    // derived values keep full precision (renderers round for display)
    tInflection,
    maxGrowth: (r * K) / 4,
    tDouble,
    horizon: Number(horizon.toFixed(2)),
  };
}

/**
 * SIR epidemic model — dS/dt = −βSI, dI/dt = βSI − γI, dR/dt = γI in FRACTIONS
 * of the population (so S+I+R = 1 is conserved and numbers stay O(1)).
 * Integrated with classic RK4 at dt = 0.01 days — stable across the whole
 * parameter range (β ≤ 0.8 keeps the largest eigenwell-conditioned).
 * R0 = β/γ decides everything: R0 < 1 dies out, R0 > 1 peaks then burns out.
 */
export function simulateSir(params: Record<string, number>): SirResult {
  const N = Math.max(1000, readNum(params, "population", 10000, 1000, 10000));
  const i0 = Math.min(0.5, Math.max(0.0001, readNum(params, "initial_infected", 5, 1, 100) / N));
  const beta = readNum(params, "beta", 0.4, 0.05, 0.8);
  const gamma = readNum(params, "gamma", 0.25, 0.05, 1);
  const r0 = beta / gamma;

  const dt = 0.01;
  const sampleEvery = 100; // one sample per day
  const maxDays = 400;
  const s0 = 1 - i0;
  const r0frac = 0;

  const deriv = (s: number, i: number): [number, number, number] => {
    const infection = beta * s * i;
    return [-infection, infection - gamma * i, gamma * i];
  };

  let s = s0;
  let i = i0;
  let rec = r0frac;
  const points: { t: number; s: number; i: number; r: number }[] = [];
  let peakInfected = i;
  let peakDay = 0;
  let burnedOut = false;

  for (let step = 0; step <= maxDays / dt; step++) {
    if (step % sampleEvery === 0) {
      const t = step * dt;
      points.push({ t: Number(t.toFixed(1)), s: Number(s.toFixed(6)), i: Number(i.toFixed(6)), r: Number(rec.toFixed(6)) });
      if (i > peakInfected) {
        peakInfected = i;
        peakDay = Number(t.toFixed(1));
      }
      if (step > 0 && i < 1e-6) burnedOut = true;
    }
    if (burnedOut) break;
    // classic RK4
    const [k1s, k1i] = deriv(s, i);
    const [k2s, k2i] = deriv(s + (k1s * dt) / 2, i + (k1i * dt) / 2);
    const [k3s, k3i] = deriv(s + (k2s * dt) / 2, i + (k2i * dt) / 2);
    const [k4s, k4i] = deriv(s + k3s * dt, i + k3i * dt);
    s += (dt / 6) * (k1s + 2 * k2s + 2 * k3s + k4s);
    i += (dt / 6) * (k1i + 2 * k2i + 2 * k3i + k4i);
    rec = 1 - s - i; // keep S+I+R = 1 exactly (recovers only, never "unrecovers")
    if (rec < 0) rec = 0; // RK4 rounding can dip ~1e-16 below 0
    s = Math.max(0, s);
    i = Math.max(0, i);
  }

  return {
    kind: "sir",
    points,
    r0: Number(r0.toFixed(2)),
    peakInfected: Number(peakInfected.toFixed(4)),
    peakDay,
    finalSize: Number((1 - points[points.length - 1]!.s).toFixed(4)),
    horizon: Number(points[points.length - 1]!.t.toFixed(1)),
  };
}

/** Dispatch a sim by name, always returning valid render data (never throws). */
export function computeSim(sim: SimName, params: Record<string, number>): SimResult {
  switch (sim) {
    case "projectile":
      return simulateProjectile(params);
    case "compound_interest":
      return simulateCompoundInterest(params);
    case "binomial":
      return simulateBinomial(params);
    case "pendulum":
      return simulatePendulum(params);
    case "rc_circuit":
      return simulateRcCircuit(params);
    case "logistic_growth":
      return simulateLogisticGrowth(params);
    case "sir_model":
      return simulateSir(params);
    default:
      return simulateProjectile(params);
  }
}
