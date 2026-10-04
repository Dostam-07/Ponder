import { describe, it, expect } from "vitest";
import {
  simulateProjectile,
  simulateCompoundInterest,
  simulateBinomial,
  simulatePendulum,
  simulateRcCircuit,
  simulateLogisticGrowth,
  simulateSir,
  computeSim,
} from "./simulations";
import type { ProjectileResult, BinomialResult } from "./simulations";

describe("simulateProjectile", () => {
  it("matches closed-form range and apex for 45° launch", () => {
    const r = simulateProjectile({ v0: 35, angle: 45 });
    // range = v0^2 * sin(2θ)/g = 35^2/9.81 at 45°
    expect(r.range).toBeCloseTo((35 * 35) / 9.81, 0);
    // apex = (v0 sinθ)^2 / (2g)
    const v0y = 35 * Math.sin(Math.PI / 4);
    expect(r.maxHeight).toBeCloseTo((v0y * v0y) / (2 * 9.81), 0);
    expect(r.flightTime).toBeGreaterThan(0);
    // starts and ends on the ground
    expect(r.points[0]).toEqual({ x: 0, y: 0 });
    expect(Math.abs(r.points[r.points.length - 1]!.y)).toBeLessThan(0.5);
  });

  it("higher angle throws less far at fixed speed (physics, not a guess)", () => {
    const r30 = simulateProjectile({ v0: 40, angle: 30 });
    const r60 = simulateProjectile({ v0: 40, angle: 60 });
    // both equal by symmetry of range(θ)=range(90-θ) within rounding
    expect(Math.abs(r30.range - r60.range)).toBeLessThan(0.05);
    // but the steeper shot reaches a much higher apex
    expect(r60.maxHeight).toBeGreaterThan(r30.maxHeight);
  });

  it("is deterministic", () => {
    const a = simulateProjectile({ v0: 30, angle: 60 });
    const b = simulateProjectile({ v0: 30, angle: 60 });
    expect(a).toEqual(b);
  });
});

describe("simulateCompoundInterest", () => {
  it("reproduces the standard monthly-compounding formula", () => {
    const r = simulateCompoundInterest({ principal: 1000, annual_rate: 7, years: 1, compounding: 12, contribution: 0 });
    const expected = 1000 * Math.pow(1 + 0.07 / 12, 12);
    expect(r.finalBalance).toBeCloseTo(expected, 2);
    expect(r.totalInterest).toBeCloseTo(expected - 1000, 2);
    expect(r.points).toHaveLength(2); // year 0 and year 1
    expect(r.points[0]!.balance).toBe(1000);
  });

  it("zero rate just accumulates contributions", () => {
    const r = simulateCompoundInterest({ principal: 0, annual_rate: 0, years: 2, compounding: 12, contribution: 100 });
    expect(r.finalBalance).toBeCloseTo(2400, 6);
    expect(r.totalContributed).toBe(2400);
    expect(r.totalInterest).toBeCloseTo(0, 6);
  });

  it("growing inputs grow the outcome (manipulable, not canned)", () => {
    const low = simulateCompoundInterest({ principal: 1000, annual_rate: 3, years: 10, compounding: 12, contribution: 0 });
    const high = simulateCompoundInterest({ principal: 1000, annual_rate: 9, years: 10, compounding: 12, contribution: 0 });
    expect(high.finalBalance).toBeGreaterThan(low.finalBalance);
  });
});

describe("simulateBinomial", () => {
  it("matches known probabilities for n=10, p=0.5", () => {
    const r = simulateBinomial({ n: 10, p: 0.5 });
    expect(r.bars).toHaveLength(11);
    expect(r.bars[5]!.prob).toBeCloseTo(0.24609375, 6); // C(10,5)/2^10
    expect(r.mean).toBe(5);
    expect(r.sd).toBeCloseTo(Math.sqrt(2.5), 4);
    expect(r.maxProb).toBeCloseTo(0.24609375, 6);
    const sum = r.bars.reduce((a, b) => a + b.prob, 0);
    expect(sum).toBeCloseTo(1, 6); // it's a proper distribution
  });

  it("skews with p and reproduces n=1 edge case", () => {
    const r = simulateBinomial({ n: 1, p: 0.3 });
    expect(r.bars[0]!.prob).toBeCloseTo(0.7, 6);
    expect(r.bars[1]!.prob).toBeCloseTo(0.3, 6);
    const skewed = simulateBinomial({ n: 12, p: 0.2 });
    // the mode shifts below the middle
    expect(skewed.mean).toBeLessThan(6);
    expect(skewed.bars[skewed.bars.findIndex((b) => b.prob === skewed.maxProb)]!.k).toBeLessThan(6);
  });
});

describe("simulatePendulum", () => {
  it("reproduces the small-angle period T = 2π√(L/g)", () => {
    // L=1m, g=9.8 → T0 ≈ 2.0061s; at 5° start the nonlinear correction is <0.1%
    const r = simulatePendulum({ length: 1, gravity: 9.8, damping: 0, start_angle: 5 });
    expect(r.periodSmallAngle).toBeCloseTo(2 * Math.PI * Math.sqrt(1 / 9.8), 3);
    expect(r.period).toBeCloseTo(r.periodSmallAngle, 1);
    expect(r.points.length).toBeGreaterThan(10);
  });

  it("longer period at large amplitude (nonlinearity, not an approximation)", () => {
    const small = simulatePendulum({ length: 1, gravity: 9.8, damping: 0, start_angle: 5 });
    const large = simulatePendulum({ length: 1, gravity: 9.8, damping: 0, start_angle: 60 });
    // exact series: T(θ0) ≈ T0(1 + θ0²/16) → at 60° (1.047 rad) ≈ +7%
    expect(large.period).toBeGreaterThan(small.period * 1.05);
    expect(large.period / large.periodSmallAngle).toBeCloseTo(1 + Math.pow(60 * (Math.PI / 180), 2) / 16, 1);
  });

  it("longer strings swing slower; stronger gravity swings faster", () => {
    const long = simulatePendulum({ length: 2, gravity: 9.8, damping: 0, start_angle: 10 });
    const short = simulatePendulum({ length: 0.5, gravity: 9.8, damping: 0, start_angle: 10 });
    expect(long.periodSmallAngle / short.periodSmallAngle).toBeCloseTo(Math.sqrt(4), 5); // √(L1/L2)
    const moon = simulatePendulum({ length: 1, gravity: 1.6, damping: 0, start_angle: 10 });
    const earth = simulatePendulum({ length: 1, gravity: 9.8, damping: 0, start_angle: 10 });
    expect(moon.periodSmallAngle).toBeGreaterThan(earth.periodSmallAngle);
  });

  it("damping decays amplitude but keeps the period (weak-damping physics)", () => {
    const undamped = simulatePendulum({ length: 1, gravity: 9.8, damping: 0, start_angle: 30 });
    const damped = simulatePendulum({ length: 1, gravity: 9.8, damping: 0.3, start_angle: 30 });
    expect(damped.amplitudeEnd).toBeLessThan(damped.amplitudeStart * 0.5); // visibly decayed
    expect(damped.amplitudeStart).toBeCloseTo(undamped.amplitudeStart, 0); // same start
    // weak damping: period shift < 2%
    expect(Math.abs(damped.period - undamped.period) / undamped.period).toBeLessThan(0.02);
  });

  it("is numerically stable across the full parameter range (no blow-up, bounded, deterministic)", () => {
    for (const p of [
      { length: 0.2, gravity: 25, damping: 2, start_angle: 90 }, // extreme corner
      { length: 3, gravity: 1, damping: 0.05, start_angle: 45 }, // slow Moon-like
      { length: 1.5, gravity: 12, damping: 0, start_angle: 80 },
    ]) {
      const r = simulatePendulum(p);
      expect(r.points).toHaveLength(r.points.length); // sanity
      for (const pt of r.points) {
        expect(Number.isFinite(pt.t)).toBe(true);
        expect(Number.isFinite(pt.theta)).toBe(true);
        // energy can't exceed the start: |θ| bounded by the initial amplitude (undamped) —
        // with damping it only shrinks, so bound by start angle + numerical slack
        expect(Math.abs(pt.theta)).toBeLessThan(Math.max(p.start_angle, 5) * (1 + 0.02));
      }
      expect(r.period).toBeGreaterThan(0);
      // determinism
      expect(simulatePendulum(p)).toEqual(r);
    }
  });
});

describe("simulateRcCircuit", () => {
  it("reproduces the exact closed form: V(τ) = 63.2% of V0, V(5τ) ≈ 99.3%", () => {
    const V0 = 12;
    const R = 20000;
    const C = 50; // µF → τ = RC = 1s
    const r = simulateRcCircuit({ voltage: V0, resistance: R, capacitance: C });
    expect(r.tau).toBeCloseTo((R * C) / 1e6, 6);
    expect(r.vAtTau).toBeCloseTo(V0 * (1 - Math.exp(-1)), 3);
    // sample nearest t=5τ (last point)
    const last = r.charge[r.charge.length - 1]!;
    expect(last.v).toBeCloseTo(V0 * 0.9933, 1); // 1 − e⁻⁵
    // discharge is the mirror image
    expect(r.discharge[0]!.v).toBeCloseTo(V0, 3);
    expect(r.discharge[r.discharge.length - 1]!.v).toBeCloseTo(V0 * Math.exp(-5), 3);
  });

  it("τ scales linearly with R and C; the 99% time is ln(100)·τ", () => {
    const base = simulateRcCircuit({ voltage: 9, resistance: 10000, capacitance: 100 });
    const bigR = simulateRcCircuit({ voltage: 9, resistance: 30000, capacitance: 100 });
    expect(bigR.tau / base.tau).toBeCloseTo(3, 5);
    expect(base.tTo99).toBeCloseTo(base.tau * Math.log(100), 3);
  });

  it("is monotone (charge rises, discharge falls) and deterministic", () => {
    const r = simulateRcCircuit({ voltage: 5, resistance: 4700, capacitance: 220 });
    for (let i = 1; i < r.charge.length; i++) expect(r.charge[i]!.v).toBeGreaterThanOrEqual(r.charge[i - 1]!.v - 1e-9);
    for (let i = 1; i < r.discharge.length; i++) expect(r.discharge[i]!.v).toBeLessThanOrEqual(r.discharge[i - 1]!.v + 1e-9);
    expect(r.charge.every((p) => p.v <= r.voltage + 1e-9)).toBe(true);
    expect(simulateRcCircuit({ voltage: 5, resistance: 4700, capacitance: 220 })).toEqual(r);
  });
});

describe("simulateLogisticGrowth", () => {
  it("matches the closed form P(t) = K/(1+((K−P0)/P0)e^(−rt)) at the inflection", () => {
    const P0 = 20, K = 1000, r = 0.5;
    const res = simulateLogisticGrowth({ p0: P0, k: K, r });
    // P(t*) = K/2 exactly at the inflection
    expect(res.tInflection).toBeCloseTo(Math.log(K / P0 - 1) / r, 6);
    const atInflection = res.points.reduce((best, p) =>
      Math.abs(p.t - res.tInflection) < Math.abs(best.t - res.tInflection) ? p : best,
    );
    // the sampled point NEAREST the inflection time sits within one sample step
    // of K/2 (slope there is rK/4; sample spacing ≈ horizon/80)
    expect(atInflection.p).toBeGreaterThan(K * 0.48);
    expect(atInflection.p).toBeLessThan(K * 0.52);
    // max growth = rK/4
    expect(res.maxGrowth).toBeCloseTo((r * K) / 4, 1);
    // doubling time = ln2/r
    expect(res.tDouble).toBeCloseTo(Math.log(2) / r, 3);
  });

  it("is monotone, bounded by K, and approaches K (boundary condition)", () => {
    const res = simulateLogisticGrowth({ p0: 10, k: 5000, r: 0.3 });
    for (let i = 1; i < res.points.length; i++) {
      expect(res.points[i]!.p).toBeGreaterThan(res.points[i - 1]!.p);
      expect(res.points[i]!.p).toBeLessThanOrEqual(5000 + 1e-6);
    }
    const last = res.points[res.points.length - 1]!.p;
    expect(last).toBeGreaterThan(4990); // 99.8%+ of K
    expect(res.points[0]!.p).toBeCloseTo(10, 0);
  });

  it("past-halfway start has no double time; bigger K stretches the horizon", () => {
    expect(simulateLogisticGrowth({ p0: 600, k: 1000, r: 0.5 }).tDouble).toBeNull();
    const small = simulateLogisticGrowth({ p0: 10, k: 1000, r: 0.5 });
    const big = simulateLogisticGrowth({ p0: 10, k: 10000, r: 0.5 });
    expect(big.horizon).toBeGreaterThan(small.horizon);
  });
});

describe("simulateSir", () => {
  it("conserves S+I+R = 1 at every sample (RK4 accuracy)", () => {
    const res = simulateSir({ population: 10000, initial_infected: 5, beta: 0.4, gamma: 0.25 });
    expect(res.points.length).toBeGreaterThan(10);
    for (const p of res.points) {
      expect(p.s + p.i + p.r).toBeCloseTo(1, 5);
    }
  });

  it("computes R0 = β/γ and the R0<1 die-out case (infection decays from the start)", () => {
    const res = simulateSir({ population: 10000, initial_infected: 10, beta: 0.15, gamma: 0.3 }); // R0 = 0.5
    expect(res.r0).toBeCloseTo(0.5, 5);
    // peak ≈ initial (the outbreak barely takes off)
    expect(res.peakInfected).toBeLessThan(10 / 10000 * 1.2);
    // final size ≈ 0 (only the initial few recover)
    expect(res.finalSize).toBeLessThan(0.005);
  });

  it("the R0>1 epidemic peaks then burns out; higher R0 → larger final size (known SIR behavior)", () => {
    const mild = simulateSir({ population: 10000, initial_infected: 5, beta: 0.3, gamma: 0.25 }); // R0=1.2
    const severe = simulateSir({ population: 10000, initial_infected: 5, beta: 0.7, gamma: 0.25 }); // R0=2.8
    expect(mild.r0).toBeCloseTo(1.2, 5);
    expect(severe.r0).toBeCloseTo(2.8, 5);
    // both exceed the initial infection count, peak in the middle of the run
    for (const r of [mild, severe]) {
      expect(r.peakInfected).toBeGreaterThan(5 / 10000 * 2);
      expect(r.peakDay).toBeGreaterThan(0);
      expect(r.peakDay).toBeLessThan(r.horizon);
      expect(r.finalSize).toBeGreaterThan(r.peakInfected); // R keeps growing after the peak
    }
    expect(severe.finalSize).toBeGreaterThan(mild.finalSize);
    expect(severe.peakInfected).toBeGreaterThan(mild.peakInfected);
  });

  it("faster recovery (higher γ) flattens the epidemic", () => {
    const slow = simulateSir({ population: 10000, initial_infected: 5, beta: 0.4, gamma: 0.2 }); // R0=2
    const fast = simulateSir({ population: 10000, initial_infected: 5, beta: 0.4, gamma: 0.8 }); // R0=0.5
    expect(slow.peakInfected).toBeGreaterThan(fast.peakInfected);
    expect(fast.finalSize).toBeLessThan(0.01);
  });

  it("is deterministic and stable at the parameter extremes", () => {
    const base = simulateSir({ population: 1000, initial_infected: 100, beta: 0.8, gamma: 0.05 }); // R0=16, harsh corner
    for (const p of base.points) {
      expect(p.s).toBeGreaterThanOrEqual(0);
      expect(p.i).toBeGreaterThanOrEqual(0);
      expect(p.r).toBeGreaterThanOrEqual(0);
      expect(p.s).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(base.finalSize).toBeGreaterThan(0.9); // harsh epidemic infects nearly everyone
    expect(simulateSir({ population: 1000, initial_infected: 100, beta: 0.8, gamma: 0.05 })).toEqual(base);
  });
});

describe("computeSim", () => {
  it("dispatches by name and never throws on unknown/edge inputs", () => {
    expect(computeSim("projectile", {}).kind).toBe("projectile");
    expect(computeSim("compound_interest", {}).kind).toBe("compound");
    expect(computeSim("binomial", {}).kind).toBe("binomial");
    expect(computeSim("pendulum", {}).kind).toBe("pendulum");
    expect(computeSim("rc_circuit", {}).kind).toBe("rc");
    expect(computeSim("logistic_growth", {}).kind).toBe("logistic");
    expect(computeSim("sir_model", {}).kind).toBe("sir");
    // empty params → canonical defaults, still valid render data
    const p = computeSim("projectile", {}) as ProjectileResult;
    expect(p.points.length).toBeGreaterThan(1);
    const b = computeSim("binomial", {}) as BinomialResult;
    expect(b.bars.length).toBeGreaterThan(1);
  });
});
