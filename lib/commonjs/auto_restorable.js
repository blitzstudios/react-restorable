"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getRestorationStats = getRestorationStats;
exports.getRestoredChangedSites = getRestoredChangedSites;
exports.isRestorable = isRestorable;
exports.useAutoState = useAutoState;
exports.useRestorationFrame = useRestorationFrame;
exports.useScopedKey = useScopedKey;
var _react = require("react");
var _equality = require("./equality.js");
var _restorable_state = require("./restorable_state.js");
/**
 * Runtime behind the restoration transform (`@sleeperhq/react-restorable/babel`), which gives every
 * function calling a state hook one restoration frame. Nothing is serialized: values are held by
 * reference, so "restorable" means safe and cheap to hold onto, not JSON-encodable.
 */

/** Per frame, the values of its slots that were worth keeping. */
const valueStore = new Map();
(0, _restorable_state.registerScopedStore)(valueStore);

/** One entry per component instance an evicted tab held; each slot is capped at `MAX_NODES`. */
const MAX_ENTRIES = 20000;

/** A selection, a filter set, a few expanded row ids — anything larger is React Query's to own. */
const MAX_NODES = 256;
function isPlainContainer(value) {
  if (Array.isArray(value) || value instanceof Set || value instanceof Map) return true;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Whether a value can be held across an unmount. Rejects functions and symbols (a stale closure
 * outlives the tree it captured), class instances, React elements, and anything past the budget.
 */
function isRestorable(value) {
  const seen = new Set();
  let budget = MAX_NODES;
  const visit = node => {
    budget -= 1;
    if (budget < 0) return false;
    const type = typeof node;
    if (node === null || type === 'undefined' || type === 'boolean' || type === 'number' || type === 'string') return true;
    if (type !== 'object') return false;
    const object = node;
    if (seen.has(object)) return true;
    seen.add(object);
    if ('$$typeof' in object) return false;
    if (!isPlainContainer(object)) return false;
    if (object instanceof Set) return Array.from(object).every(visit);
    if (object instanceof Map) return Array.from(object.entries()).every(([k, v]) => visit(k) && visit(v));
    if (Array.isArray(object)) return object.every(visit);
    return Object.values(object).every(visit);
  };
  return visit(value);
}

/** A key held by more than one live instance is not a per-screen singleton, so it disables itself. */
const liveInstanceCounts = new Map();
const contendedKeys = new Set();

/** Per mount, so the counters stay comparable. */
const stats = {
  restored: 0,
  restoredChanged: 0,
  missed: 0,
  refusedUnanchored: 0,
  refusedContended: 0,
  evicted: 0
};
const refusedUnanchoredIds = new Set();
const refusedContendedKeys = new Set();
/** `frameId:slot` → restores that differed from the initial value, which is what a user can actually see. */
const restoredChangedSites = new Map();
(0, _restorable_state.registerTestReset)(() => {
  stats.restored = 0;
  stats.restoredChanged = 0;
  stats.missed = 0;
  stats.refusedUnanchored = 0;
  stats.refusedContended = 0;
  stats.evicted = 0;
  refusedUnanchoredIds.clear();
  refusedContendedKeys.clear();
  restoredChangedSites.clear();
  liveInstanceCounts.clear();
  contendedKeys.clear();
});
const reportOnce = _restorable_state.reportRestorationOnce;
function recordMiss(key, frameId, slot) {
  const site = `${frameId}:${slot}`;
  reportOnce('miss', site, () => {
    const suffix = `|${frameId}`;
    let rival;
    for (const stored of valueStore.keys()) {
      if (stored !== key && stored.endsWith(suffix)) {
        rival = stored;
        break;
      }
    }
    return rival ? `[restore-miss] SCOPE-MOVED site=${site} want=${key} have=${rival}` : `[restore-miss] EMPTY site=${site} want=${key}`;
  });
}
function getRestorationStats() {
  return {
    ...stats,
    ..._restorable_state.restorationCounters,
    values: valueStore.size,
    contended: contendedKeys.size,
    live: liveInstanceCounts.size,
    refusedUnanchoredIdsDistinct: refusedUnanchoredIds.size,
    refusedContendedKeysDistinct: refusedContendedKeys.size,
    restoredChangedSitesDistinct: restoredChangedSites.size
  };
}

/** The call sites whose restores most often brought back something other than the initial value. */
function getRestoredChangedSites(limit = 20) {
  return Array.from(restoredChangedSites.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit);
}

/** Registers one live holder of `key`, marking it contended when there is already another. */
function holdKey(key) {
  const count = (liveInstanceCounts.get(key) ?? 0) + 1;
  liveInstanceCounts.set(key, count);
  if (count > 1) {
    reportOnce('contended', key, () => `[restore-contended] ${count} live holders of key=${key}`);
    contendedKeys.add(key);
  }
  return count;
}
function releaseKey(key) {
  const remaining = (liveInstanceCounts.get(key) ?? 1) - 1;
  if (remaining > 0) {
    liveInstanceCounts.set(key, remaining);
    return;
  }
  liveInstanceCounts.delete(key);
  // Contention is live: a transient double-mount must not disable the key for the process.
  contendedKeys.delete(key);
}

/**
 * The scope to key by, or null when this component must not restore at all. Owns the key's entry in
 * `store`: forgotten when the component is removed or the key is contended, and handed to `onDetach`
 * when it is hidden or evicted, with the generation to write under.
 */
function useScopedKey(id, store, enabled, onDetach) {
  const scope = (0, _restorable_state.useRestorationScope)();
  const hiddenNode = (0, _restorable_state.useRestorationHiddenNode)();
  const isAnchored = enabled && (0, _restorable_state.getIsRestorationEnabled)() && !scope.startsWith(_restorable_state.UNANCHORED_SCOPE_PREFIX);
  const key = `${scope}|${id}`;
  // Refusal is decided during render, so this keeps the count per-mount rather than per-render.
  const refusalCountedRef = (0, _react.useRef)(null);
  const countRefusalOnce = outcome => {
    const token = `${key}|${outcome}`;
    if (refusalCountedRef.current === token) return false;
    refusalCountedRef.current = token;
    return true;
  };
  (0, _react.useEffect)(() => {
    if (!isAnchored) return undefined;
    const generation = (0, _restorable_state.getRestorationGeneration)(key);
    if (holdKey(key) > 1) store.delete(key);
    return () => {
      if (contendedKeys.has(key) || (0, _restorable_state.getDetachReason)(hiddenNode, key, generation) === 'removed') store.delete(key);else onDetach?.(key, generation);
      releaseKey(key);
    };
  }, [key, isAnchored, store, hiddenNode, onDetach]);
  if (!isAnchored) {
    if (enabled && (0, _restorable_state.getIsRestorationEnabled)() && countRefusalOnce('unanchored')) {
      stats.refusedUnanchored += 1;
      refusedUnanchoredIds.add(id);
      reportOnce('unanchored', id, () => `[restore-unanchored] id=${id} scope=${scope}`);
    }
    return null;
  }
  if (contendedKeys.has(key)) {
    if (countRefusalOnce('contended')) {
      stats.refusedContended += 1;
      refusedContendedKeys.add(key);
      reportOnce('contended', key, () => `[restore-contended] refused key=${key}`);
    }
    return null;
  }
  return key;
}
function isPartialValue(value) {
  return typeof value === 'object' && value !== null && value.__restorablePartial === true;
}

/** As opposed to an array, a Set or a Map, which are kept whole or not at all. */
function isPlainRecord(value) {
  if (typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value) || value instanceof Set || value instanceof Map) return false;
  if ('$$typeof' in value) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * What to keep of a slot's value, or `undefined` for nothing. A record keeps its restorable fields
 * rather than being discarded over the one that cannot be held, since a single `Animated.Value`
 * would cost every selection beside it; the fields are overlaid on a fresh initial value on return.
 */
function toStorable(value) {
  if (!isPlainRecord(value)) return isRestorable(value) ? {
    value
  } : undefined;
  const fields = {};
  let kept = 0;
  for (const [field, fieldValue] of Object.entries(value)) {
    if (isRestorable(fieldValue)) {
      fields[field] = fieldValue;
      kept += 1;
    }
  }
  return kept === 0 ? undefined : {
    value: {
      __restorablePartial: true,
      fields
    }
  };
}
function differsFromInitial(stored, initial) {
  if (!isPartialValue(stored)) return !(0, _equality.isRestorableEqual)(stored, initial);
  const initialRecord = initial ?? {};
  return Object.entries(stored.fields).some(([field, value]) => !(0, _equality.isRestorableEqual)(value, initialRecord[field]));
}
function resolveInitial(init) {
  return typeof init === 'function' ? init() : init;
}

/** The surface the transform calls into, shared by the live frame and the inert one. */

const INERT_FRAME = {
  initial: (_slot, init) => init,
  state: (_slot, tuple) => tuple
};
class RestorationFrame {
  isMounting = true;
  rendered = [];
  committed = [];
  constructor(frameId, key) {
    this.frameId = frameId;
    this.key = key;
    if (key === null) {
      stats.refusedUnanchored += 1;
      refusedUnanchoredIds.add(frameId);
      reportOnce('unanchored', frameId, () => `[restore-unanchored] frame=${frameId}`);
      return;
    }
    // Two holders of one key cannot both be handed its value, and neither is the one that left it.
    if (!contendedKeys.has(key)) this.restored = (0, _restorable_state.readRestorable)(valueStore, key)?.value;
  }
  initial(slot, init) {
    // Hooks only use their argument on mount, so past it there is nothing to decide.
    if (!this.isMounting || this.key === null) return init;
    if (!this.restored?.has(slot)) {
      stats.missed += 1;
      recordMiss(this.key, this.frameId, slot);
      return init;
    }

    // Resolved here only to overlay a partial record and to tell whether the restore changed anything.
    const initial = resolveInitial(init);
    const stored = this.restored.get(slot);
    stats.restored += 1;
    if (differsFromInitial(stored, initial)) {
      const site = `${this.frameId}:${slot}`;
      stats.restoredChanged += 1;
      restoredChangedSites.set(site, (restoredChangedSites.get(site) ?? 0) + 1);
      reportOnce('ok', site, () => `[restore-ok] site=${site} key=${this.key}`);
    }
    return isPartialValue(stored) ? {
      ...initial,
      ...stored.fields
    } : stored;
  }
  state(slot, tuple) {
    this.rendered[slot] = tuple[0];
    return tuple;
  }

  /** Promotes what the last committed render tracked, so a render React threw away is never kept. */
  commit() {
    this.isMounting = false;
    const previous = this.committed;
    this.committed = this.rendered;
    this.rendered = previous;
  }
  attach(hiddenNode) {
    const key = this.key;
    if (key === null) return undefined;

    // This instance owns what it restored now; a later remount in the same tab starts fresh.
    valueStore.delete(key);
    this.restored = undefined;
    const generation = (0, _restorable_state.getRestorationGeneration)(key);
    const count = holdKey(key);
    if (count > 1) {
      // Counts the holder that was already there once, and each one that joins it.
      const refused = count === 2 ? 2 : 1;
      stats.refusedContended += refused;
      refusedContendedKeys.add(key);
    }
    return () => {
      if (!contendedKeys.has(key) && (0, _restorable_state.getDetachReason)(hiddenNode, key, generation) !== 'removed') this.snapshot(key, generation);
      releaseKey(key);
    };
  }

  /** Runs once per eviction or hide, which is the only moment the values are needed. */
  snapshot(key, generation) {
    const values = new Map();
    for (let slot = 0; slot < this.committed.length; slot++) {
      const storable = toStorable(this.committed[slot]);
      if (storable) values.set(slot, storable.value);
    }
    if (values.size === 0) {
      valueStore.delete(key);
      return;
    }
    (0, _restorable_state.writeRestorable)(valueStore, key, values, generation);
    while (valueStore.size > MAX_ENTRIES) {
      const oldest = valueStore.keys().next();
      if (oldest.done) return;
      valueStore.delete(oldest.value);
      stats.evicted += 1;
    }
  }
}
function useLiveRestorationFrame(frameId) {
  'use no memo';

  const scope = (0, _restorable_state.useRestorationScope)();
  const hiddenNode = (0, _restorable_state.useRestorationHiddenNode)();
  const key = scope.startsWith(_restorable_state.UNANCHORED_SCOPE_PREFIX) ? null : `${scope}|${frameId}`;
  const [frame] = (0, _react.useState)(() => new RestorationFrame(frameId, key));
  frame.key = key;
  (0, _react.useEffect)(() => {
    frame.commit();
  });
  (0, _react.useEffect)(() => frame.attach(hiddenNode), [frame, key, hiddenNode]);
  return frame;
}

/**
 * One per function that calls a state hook, injected by the transform. The gate is read once per
 * launch, so with eviction off this calls no hooks at all and the frame costs nothing.
 */
function useRestorationFrame(frameId) {
  'use no memo';

  if (!(0, _restorable_state.getIsRestorationEnabled)()) return INERT_FRAME;
  // eslint-disable-next-line react-hooks/rules-of-hooks -- the condition is fixed for the life of the process
  return useLiveRestorationFrame(frameId);
}

/** What the transform emits for a component with a single `useState`. */
function useAutoState(id, initialValue) {
  'use no memo';

  const frame = useRestorationFrame(id);
  return frame.state(0, (0, _react.useState)(frame.initial(0, initialValue)));
}
//# sourceMappingURL=auto_restorable.js.map