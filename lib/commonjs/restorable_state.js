"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.RestorationHiddenBoundary = RestorationHiddenBoundary;
exports.RestorationNamespace = RestorationNamespace;
exports.UNANCHORED_SCOPE_PREFIX = void 0;
exports.configureRestorationScope = configureRestorationScope;
exports.forgetRestorableState = forgetRestorableState;
exports.getDetachReason = getDetachReason;
exports.getIsRestorationDebugEnabled = getIsRestorationDebugEnabled;
exports.getIsRestorationEnabled = getIsRestorationEnabled;
exports.getRestorationGeneration = getRestorationGeneration;
exports.hasRestorableStateForTests = hasRestorableStateForTests;
exports.isRestorationHidden = isRestorationHidden;
exports.markEvicted = markEvicted;
exports.pruneRestorableState = pruneRestorableState;
exports.readRestorable = readRestorable;
exports.registerScopedStore = registerScopedStore;
exports.registerTestReset = registerTestReset;
exports.reportRestorationOnce = reportRestorationOnce;
exports.resetRestorationForTests = resetRestorationForTests;
exports.restorableStateSizeForTests = restorableStateSizeForTests;
exports.restorationCounters = void 0;
exports.seedRestorableStateForTests = seedRestorableStateForTests;
exports.setRestorationDebugEnabled = setRestorationDebugEnabled;
exports.setRestorationEnabled = setRestorationEnabled;
exports.useRestorableState = useRestorableState;
exports.useRestorationHiddenNode = useRestorationHiddenNode;
exports.useRestorationScope = useRestorationScope;
exports.writeRestorable = writeRestorable;
var _react = _interopRequireWildcard(require("react"));
var _jsxRuntime = require("react/jsx-runtime");
function _interopRequireWildcard(e, t) { if ("function" == typeof WeakMap) var r = new WeakMap(), n = new WeakMap(); return (_interopRequireWildcard = function (e, t) { if (!t && e && e.__esModule) return e; var o, i, f = { __proto__: null, default: e }; if (null === e || "object" != typeof e && "function" != typeof e) return f; if (o = t ? n : r) { if (o.has(e)) return o.get(e); o.set(e, f); } for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]); return f; })(e, t); }
/**
 * Component state that survives its tree being evicted, keyed so it returns to the place it was left.
 * Only an eviction carries state over: any other remount starts fresh.
 *
 * Everything is keyed by a scope, `root|anchor|…`. The root is the tree an eviction unmounts as a
 * whole, a bottom tab say, and is what `markEvicted` and `forgetRestorableState` take. The anchor is
 * the place inside it whose departure makes its state stale, and is what `pruneRestorableState`
 * judges. A scope starting `unanchored|` never restores.
 */

const UNANCHORED_SCOPE_PREFIX = exports.UNANCHORED_SCOPE_PREFIX = 'unanchored|';
const UNANCHORED_SCOPE = `${UNANCHORED_SCOPE_PREFIX}none|`;
let isDebugEnabled = false;
let isRestorationEnabled = false;

/**
 * Set once, before anything renders, and never again: restoration frames call hooks only while it is
 * on, so it must not change under a mounted component. Off, the layer costs nothing.
 */
function setRestorationEnabled(enabled) {
  isRestorationEnabled = enabled;
}
function getIsRestorationEnabled() {
  return isRestorationEnabled;
}
let useConfiguredScope = () => UNANCHORED_SCOPE;

/**
 * The hook that says which scope a component sits in, such as `useReactNavigationRestorationScope`.
 * Set once, before anything renders, since it is called as a hook. Unset, nothing is anchored.
 */
function configureRestorationScope(useScope) {
  useConfiguredScope = useScope;
}
const restorationCounters = exports.restorationCounters = {
  manualRestored: 0,
  manualMissed: 0,
  pruned: 0
};

/**
 * Whether restoration reports anything to the console. Off by default: a refusal is the layer declining to restore
 * rather than a fault, and the counters move on every navigation, so left on they are a per-navigation summary of
 * something working as designed.
 */
function setRestorationDebugEnabled(enabled) {
  isDebugEnabled = enabled;
}
function getIsRestorationDebugEnabled() {
  return isDebugEnabled;
}

/** Per kind, so the noisiest outcome cannot crowd out the informative ones. */
const REPORT_BUDGETS = {
  'manual-ok': 150,
  'manual-miss': 150,
  pruned: 200,
  ok: 150,
  miss: 150,
  contended: 60,
  unanchored: 20
};
const DEFAULT_BUDGET = 60;
const reportedByKind = new Map();
function reportRestorationOnce(kind, dedupeOn, message) {
  if (!isDebugEnabled) return;
  let seen = reportedByKind.get(kind);
  if (!seen) {
    seen = new Set();
    reportedByKind.set(kind, seen);
  }
  if (seen.has(dedupeOn) || seen.size >= (REPORT_BUDGETS[kind] ?? DEFAULT_BUDGET)) return;
  seen.add(dedupeOn);
  // eslint-disable-next-line no-console
  console.log(message());
}

/** `generation` is the owning root's eviction count when the value was written. */

const restorationStore = new Map();

/** Every scope-keyed store, so pruning, forgetting and the test reset reach all of them. */
const scopedStores = [restorationStore];
function registerScopedStore(store) {
  scopedStores.push(store);
}
const evictionCounts = new Map();

/** Called as a root's tree unmounts for an eviction, before its effect cleanups run: from a layout effect, say. */
function markEvicted(rootKey) {
  evictionCounts.set(rootKey, (evictionCounts.get(rootKey) ?? 0) + 1);
}

/** The eviction count of the root a scoped key belongs to. */
function getRestorationGeneration(key) {
  return evictionCounts.get(key.slice(0, key.indexOf('|'))) ?? 0;
}

/** Only a value written before the root's latest eviction is restored, so a remount inside a live tree starts fresh. */
function readRestorable(store, key) {
  const entry = store.get(key);
  if (!entry || entry.generation >= getRestorationGeneration(key)) return undefined;
  return entry;
}

/** Re-inserted so the map orders by write recency, which is what the size caps evict by. */
function writeRestorable(store, key, value, generation = getRestorationGeneration(key)) {
  store.delete(key);
  store.set(key, {
    value,
    generation
  });
}
const RestorationHiddenContext = /*#__PURE__*/(0, _react.createContext)(null);

/**
 * Marks a subtree an `<Activity>` hides. A hidden subtree runs its effect cleanups as an unmount
 * would, and this is how those cleanups tell the two apart.
 */
function RestorationHiddenBoundary({
  isHidden,
  children
}) {
  const parent = (0, _react.useContext)(RestorationHiddenContext);
  const [node] = (0, _react.useState)(() => ({
    isHidden,
    parent
  }));
  // Layout phase, so it is set before the passive cleanups the same commit runs for the hidden subtree.
  (0, _react.useLayoutEffect)(() => {
    node.isHidden = isHidden;
  }, [node, isHidden]);
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(RestorationHiddenContext.Provider, {
    value: node,
    children: children
  });
}
function useRestorationHiddenNode() {
  return (0, _react.useContext)(RestorationHiddenContext);
}
function isRestorationHidden(node) {
  for (let current = node; current; current = current.parent) {
    if (current.isHidden) return true;
  }
  return false;
}

/**
 * Why a restorable instance let go of its key: its subtree was hidden, its root was evicted, or it
 * was removed. Only a removal forgets the value, since nothing is coming back for it.
 */
function getDetachReason(node, key, generationAtAttach) {
  if (isRestorationHidden(node)) return 'hidden';
  if (getRestorationGeneration(key) !== generationAtAttach) return 'evicted';
  return 'removed';
}

/** Registered rather than called directly, so this module need not import the modules that keep their own state. */
const testResets = [];
function registerTestReset(reset) {
  testResets.push(reset);
}

/** Guards against growth from a scope that is never pruned. */
const MAX_ENTRIES = 500;

/** Drops state whose anchor has left the tree. Judged against every reachable place, not the focused one. */
function shouldDrop(storeKey, liveKeysByRoot) {
  const [rootKey, anchorKey] = storeKey.split('|');
  if (`${rootKey}|` === UNANCHORED_SCOPE_PREFIX) return false;
  const path = liveKeysByRoot[rootKey];
  if (!path) return true;
  // The anchor cannot be judged yet. React Navigation, for one, leaves a nested navigator's state undefined until it
  // diverges from its initial state, which is normal for a tab at its stack root.
  if (path.length <= 1) return false;
  return !path.includes(anchorKey);
}

/**
 * Drops state whose anchor is no longer reachable. `liveKeysByRoot` maps each root to every anchor key
 * still under it, the root's own key first; a root missing from it is gone entirely.
 */
function pruneRestorableState(liveKeysByRoot) {
  for (const store of scopedStores) {
    for (const key of Array.from(store.keys())) {
      if (shouldDrop(key, liveKeysByRoot)) {
        store.delete(key);
        restorationCounters.pruned += 1;
        reportRestorationOnce('pruned', key, () => `[restore-pruned] key=${key} live=${(liveKeysByRoot[key.split('|')[0]] ?? []).join('>')}`);
      }
    }
  }
}
function evictOldestIfNeeded() {
  while (restorationStore.size > MAX_ENTRIES) {
    const oldest = restorationStore.keys().next();
    if (oldest.done) return;
    restorationStore.delete(oldest.value);
  }
}
const RestorationNamespaceContext = /*#__PURE__*/(0, _react.createContext)('');

/**
 * Distinguishes sibling renders of one component. Automatic ids come from the call site, so two
 * scenes of a tab view would otherwise share a key and the contention guard would give up on both.
 */
function RestorationNamespace({
  name,
  children
}) {
  const parent = (0, _react.useContext)(RestorationNamespaceContext);
  const value = (0, _react.useMemo)(() => parent ? `${parent}>${name}` : name, [parent, name]);
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(RestorationNamespaceContext.Provider, {
    value: value,
    children: children
  });
}

/** The scope this component sits in, as the configured scope hook sees it plus any namespaces around it. */
function useRestorationScope() {
  const scope = useConfiguredScope();
  const namespace = (0, _react.useContext)(RestorationNamespaceContext);
  // Appended past the anchor so pruning still reads the root and anchor keys it judges by.
  return namespace ? `${scope}::${namespace}` : scope;
}

/** `useState`, except the value survives an eviction. `id` need only be unique within its scope. */
function useRestorableState(id, initialValue) {
  const key = `${useRestorationScope()}|${id}`;
  const hiddenNode = useRestorationHiddenNode();
  const [value, setValue] = (0, _react.useState)(() => {
    const initial = () => typeof initialValue === 'function' ? initialValue() : initialValue;
    if (!isRestorationEnabled) return initial();
    const entry = readRestorable(restorationStore, key);
    if (entry) {
      restorationCounters.manualRestored += 1;
      reportRestorationOnce('manual-ok', id, () => `[restore-manual-ok] id=${id} key=${key}`);
      return entry.value;
    }
    restorationCounters.manualMissed += 1;
    reportRestorationOnce('manual-miss', id, () => `[restore-manual-miss] id=${id} key=${key}`);
    return initial();
  });

  // Written on change, not on unmount, since eviction unmounts without warning.
  (0, _react.useEffect)(() => {
    if (!isRestorationEnabled) return;
    writeRestorable(restorationStore, key, value);
    evictOldestIfNeeded();
  }, [key, value]);
  (0, _react.useEffect)(() => {
    if (!isRestorationEnabled) return undefined;
    const generation = getRestorationGeneration(key);
    return () => {
      if (getDetachReason(hiddenNode, key, generation) === 'removed') restorationStore.delete(key);
    };
  }, [key, hiddenNode]);
  return [value, setValue];
}

/** Drops everything kept for one root: every anchored scope begins with its key. */
function forgetRestorableState(rootKey) {
  const prefix = `${rootKey}|`;
  let forgotten = 0;
  for (const store of scopedStores) {
    for (const key of Array.from(store.keys())) {
      if (key.startsWith(prefix)) {
        store.delete(key);
        forgotten += 1;
      }
    }
  }
  if (forgotten > 0) reportRestorationOnce('forgotten', `${rootKey}:${Date.now()}`, () => `[restore-forgotten] root=${rootKey} entries=${forgotten}`);
  return forgotten;
}
function resetRestorationForTests() {
  for (const store of scopedStores) store.clear();
  for (const reset of testResets) reset();
  evictionCounts.clear();
  // Tests are about eviction; a test of the off path opts out with `setRestorationEnabled(false)`.
  isRestorationEnabled = true;
}

/** Seeds a value as written before the root's latest eviction, so it restores. */
function seedRestorableStateForTests(scope, id, value) {
  restorationStore.set(`${scope}|${id}`, {
    value,
    generation: -1
  });
}
function hasRestorableStateForTests(scope, id) {
  return restorationStore.has(`${scope}|${id}`);
}
function restorableStateSizeForTests() {
  return restorationStore.size;
}
//# sourceMappingURL=restorable_state.js.map