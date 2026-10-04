import { describe, it, expect } from "vitest";
import { wheelShouldConsume, type ScrollMetrics } from "./wheel";

const el = (scrollTop: number, clientHeight = 200, scrollHeight = 600): ScrollMetrics => ({
  scrollTop,
  clientHeight,
  scrollHeight,
});

describe("wheelShouldConsume — canvas zoom isolation (spec §zoom stability)", () => {
  it("never consumes when the text fits (no overflow → canvas zooms normally)", () => {
    expect(wheelShouldConsume(el(0, 300, 300), 120)).toBe(false);
    expect(wheelShouldConsume(el(0, 300, 300), -120)).toBe(false);
    // exactly at the cap (no room) → not overflowing
    expect(wheelShouldConsume(el(0, 256, 256), 120)).toBe(false);
  });

  it("consumes downward scroll while the text can still scroll down", () => {
    expect(wheelShouldConsume(el(0), 120)).toBe(true);
    expect(wheelShouldConsume(el(100), 120)).toBe(true);
  });

  it("hands the wheel back to the canvas at the BOTTOM of the text (scroll chaining)", () => {
    // 398 + 200 = 598 < 599 → one px of headroom: text still scrolls
    expect(wheelShouldConsume(el(398), 120)).toBe(true);
    // 399 + 200 = 599 → at the bottom: canvas zoom takes over
    expect(wheelShouldConsume(el(399), 120)).toBe(false);
    expect(wheelShouldConsume(el(400), 120)).toBe(false);
  });

  it("hands the wheel back to the canvas at the TOP of the text", () => {
    expect(wheelShouldConsume(el(0), -120)).toBe(false);
    expect(wheelShouldConsume(el(1), -120)).toBe(false);
    expect(wheelShouldConsume(el(2), -120)).toBe(true);
  });

  it("consumes upward scroll while the text can still scroll up", () => {
    expect(wheelShouldConsume(el(150), -120)).toBe(true);
  });

  it("does not consume vertical-neutral gestures (deltaY = 0 → pinch/trackpad zoom preserved)", () => {
    expect(wheelShouldConsume(el(0), 0)).toBe(false);
    expect(wheelShouldConsume(el(150), 0)).toBe(false);
  });
});
