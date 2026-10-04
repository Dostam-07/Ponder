import { simulatePendulum } from "./src/lib/simulations";
for (const p of [
  { length: 0.2, gravity: 25, damping: 2, start_angle: 90 },
  { length: 3, gravity: 1, damping: 0.05, start_angle: 45 },
  { length: 1.5, gravity: 12, damping: 0, start_angle: 80 },
  { length: 1, gravity: 9.8, damping: 0.3, start_angle: 30 },
]) {
  const r = simulatePendulum(p);
  const maxAbs = Math.max(...r.points.map((x) => Math.abs(x.theta)));
  console.log(JSON.stringify(p), "-> period", r.period, "T0", r.periodSmallAngle, "maxAbs", maxAbs.toFixed(1), "start", r.amplitudeStart, "end", r.amplitudeEnd, "samples", r.points.length);
  console.log("  first5:", r.points.slice(0, 5).map((x) => x.theta.toFixed(1)).join(","), " last5:", r.points.slice(-5).map((x) => x.theta.toFixed(1)).join(","));
}
