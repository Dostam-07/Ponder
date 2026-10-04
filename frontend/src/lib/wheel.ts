/**
 * Wheel-event isolation for scrollable regions inside the React Flow canvas.
 *
 * Root cause of the "scrolling over text zooms the canvas" bug: React Flow
 * attaches a NATIVE wheel listener on the pane for zoom. That native listener
 * fires during bubbling before React's synthetic onWheel (delegated on the
 * root) can stopPropagation — so a React onWheel handler can NEVER win this
 * race. The only reliable isolation is a native listener on the scrollable
 * element itself, which stops the event before it reaches the pane.
 *
 * The listener must be SELECTIVE: it only consumes the wheel while the text
 * can actually scroll in that direction. At the end of the text the wheel is
 * handed back to the canvas zoom (natural scroll chaining, same as native
 * browser behavior), and canvas zoom/pan elsewhere is completely untouched.
 */
export interface ScrollMetrics {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}

/** 1px tolerance for subpixel rounding. */
const SLACK = 1;

/**
 * Should a wheel event with vertical `deltaY` over an element with these
 * metrics be consumed by the text region (stopPropagation) instead of
 * reaching the canvas zoom handler?
 *
 * - no overflow  → false (nothing to scroll; canvas behaves normally)
 * - deltaY > 0   → consume only while the text can still scroll down
 * - deltaY < 0   → consume only while the text can still scroll up
 * - deltaY === 0 → false (pinch/trackpad gestures keep their canvas meaning)
 */
export function wheelShouldConsume(el: ScrollMetrics, deltaY: number): boolean {
  if (deltaY === 0) return false;
  const overflowing = el.scrollHeight > el.clientHeight + SLACK;
  if (!overflowing) return false;
  if (deltaY > 0) {
    return el.scrollTop + el.clientHeight < el.scrollHeight - SLACK;
  }
  return el.scrollTop > SLACK;
}
