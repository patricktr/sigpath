import { createContext } from "react";
import type { PortDirection } from "../schema";

/**
 * Bulk patch — wire a fan-out in one pass instead of dragging each cable. You pick
 * output ports in order (they get 1,2,3… badges), then click input ports; each input
 * click runs the next cable, order-paired (source 1 → dest 1, source 2 → dest 2, …).
 * The source→destination phase switch is driven by port DIRECTION, not a held key:
 * clicking an input once sources are picked begins pairing. See ROADMAP "Patch
 * multiple cables at once".
 *
 * This module is the pure core (state + the click reducer) so the pairing logic is
 * unit-testable; the React glue (mode toggle, drawing edges) lives in App.
 */
export type BulkPortRef = { nodeId: string; portId: string };

export type BulkState = {
  /** Output ports picked, in click order — the left side of each pair. */
  sources: BulkPortRef[];
  /** Input ports already paired (and drawn), in order — the right side. */
  dests: BulkPortRef[];
};

export const EMPTY_BULK: BulkState = { sources: [], dests: [] };

export const sameRef = (a: BulkPortRef, b: BulkPortRef): boolean =>
  a.nodeId === b.nodeId && a.portId === b.portId;

/** Result of a port click: the next state, and an optional pair to actually draw. */
export type BulkClickResult = {
  state: BulkState;
  /** A cable to create now (source → dest). */
  draw?: { from: BulkPortRef; to: BulkPortRef };
  /** True when this click completed the batch (selection resets, mode stays on). */
  done?: boolean;
};

function drawNext(state: BulkState, dst: BulkPortRef): BulkClickResult {
  const k = state.dests.length;
  if (k >= state.sources.length) return { state }; // every source already paired
  if (state.dests.some((d) => sameRef(d, dst))) return { state }; // input already used
  const from = state.sources[k];
  if (sameRef(from, dst)) return { state }; // can't patch a port to itself (bidi)
  const dests = [...state.dests, dst];
  const done = dests.length >= state.sources.length;
  return {
    state: done ? EMPTY_BULK : { sources: state.sources, dests },
    draw: { from, to: dst },
    done,
  };
}

/**
 * Decide what a port click does in bulk mode. Pure: returns the next state plus any
 * pair to draw. While no input has been clicked yet we're in the "pick sources" phase
 * (clicking an output toggles it in/out); the first input click flips to "pairing",
 * where each dest-eligible click runs the next cable.
 */
export function bulkClick(
  state: BulkState,
  ref: BulkPortRef,
  dir: PortDirection,
): BulkClickResult {
  const srcEligible = dir === "output" || dir === "bidirectional";
  const dstEligible = dir === "input" || dir === "bidirectional";
  const pairing = state.dests.length > 0;

  if (!pairing) {
    if (srcEligible) {
      const i = state.sources.findIndex((s) => sameRef(s, ref));
      const sources =
        i >= 0 ? state.sources.filter((_, j) => j !== i) : [...state.sources, ref];
      return { state: { sources, dests: [] } };
    }
    // A pure input clicked with sources ready → begin pairing with it as dest 1.
    if (dstEligible && state.sources.length > 0) return drawNext(state, ref);
    return { state };
  }

  // Pairing phase: inputs/bidi add the next pair; outputs are ignored (sources locked).
  if (dstEligible) return drawNext(state, ref);
  return { state };
}

/** 1-based ordinal of a picked source port, or null. */
export function sourceOrdinal(state: BulkState, ref: BulkPortRef): number | null {
  const i = state.sources.findIndex((s) => sameRef(s, ref));
  return i >= 0 ? i + 1 : null;
}

/** What the instruction strip should say for the current state. */
export function bulkStatus(state: BulkState): string {
  if (state.dests.length > 0) {
    return `${state.dests.length} of ${state.sources.length} patched — keep clicking inputs in order`;
  }
  if (state.sources.length > 0) {
    const n = state.sources.length;
    return `${n} output${n === 1 ? "" : "s"} picked — now click inputs in order to run them`;
  }
  return "Click output ports in the order you want them patched, then click inputs";
}

/** Actions passed down to DeviceNode so ports can participate in bulk patch. */
export type BulkPatchActions = {
  active: boolean;
  onPortClick: (ref: BulkPortRef) => void;
  /** 1-based source ordinal for the badge, or null. */
  ordinalFor: (ref: BulkPortRef) => number | null;
};

export const BulkPatchContext = createContext<BulkPatchActions>({
  active: false,
  onPortClick: () => {},
  ordinalFor: () => null,
});
