import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';

/**
 * Component state that survives its tree being evicted, keyed so it returns to the place it was left.
 * Only an eviction carries state over: any other remount starts fresh.
 *
 * Everything is keyed by a scope, `root|anchor|…`. The root is the tree an eviction unmounts as a
 * whole, a bottom tab say, and is what `markEvicted` and `forgetRestorableState` take. The anchor is
 * the place inside it whose departure makes its state stale, and is what `pruneRestorableState`
 * judges. A scope starting `unanchored|` never restores.
 */

export const UNANCHORED_SCOPE_PREFIX = 'unanchored|';

const UNANCHORED_SCOPE = `${UNANCHORED_SCOPE_PREFIX}none|`;

let isDebugEnabled = false;

let isRestorationEnabled = false;

/**
 * Set once, before anything renders, and never again: restoration frames call hooks only while it is
 * on, so it must not change under a mounted component. Off, the layer costs nothing.
 */
export function setRestorationEnabled(enabled: boolean) {
  isRestorationEnabled = enabled;
}

export function getIsRestorationEnabled() {
  return isRestorationEnabled;
}

let useConfiguredScope: () => string = () => UNANCHORED_SCOPE;

/**
 * The hook that says which scope a component sits in, such as `useReactNavigationRestorationScope`.
 * Set once, before anything renders, since it is called as a hook. Unset, nothing is anchored.
 */
export function configureRestorationScope(useScope: () => string) {
  useConfiguredScope = useScope;
}

export const restorationCounters = { manualRestored: 0, manualMissed: 0, pruned: 0 };

/**
 * Whether restoration reports anything to the console. Off by default: a refusal is the layer declining to restore
 * rather than a fault, and the counters move on every navigation, so left on they are a per-navigation summary of
 * something working as designed.
 */
export function setRestorationDebugEnabled(enabled: boolean) {
  isDebugEnabled = enabled;
}

export function getIsRestorationDebugEnabled() {
  return isDebugEnabled;
}

/** Per kind, so the noisiest outcome cannot crowd out the informative ones. */
const REPORT_BUDGETS: Record<string, number> = {
  'manual-ok': 150,
  'manual-miss': 150,
  pruned: 200,
  ok: 150,
  miss: 150,
  contended: 60,
  unanchored: 20,
};
const DEFAULT_BUDGET = 60;
const reportedByKind = new Map<string, Set<string>>();

export function reportRestorationOnce(kind: string, dedupeOn: string, message: () => string) {
  if (!isDebugEnabled) return;

  let seen = reportedByKind.get(kind);
  if (!seen) {
    seen = new Set<string>();
    reportedByKind.set(kind, seen);
  }

  if (seen.has(dedupeOn) || seen.size >= (REPORT_BUDGETS[kind] ?? DEFAULT_BUDGET)) return;
  seen.add(dedupeOn);
  // eslint-disable-next-line no-console
  console.log(message());
}

/** `generation` is the owning root's eviction count when the value was written. */
export type RestorableEntry<T = unknown> = { value: T; generation: number };

const restorationStore = new Map<string, RestorableEntry>();

/** Every scope-keyed store, so pruning, forgetting and the test reset reach all of them. */
const scopedStores: Map<string, RestorableEntry>[] = [restorationStore];

export function registerScopedStore(store: Map<string, RestorableEntry<any>>) {
  scopedStores.push(store);
}

const evictionCounts = new Map<string, number>();

/** Called as a root's tree unmounts for an eviction, before its effect cleanups run: from a layout effect, say. */
export function markEvicted(rootKey: string) {
  evictionCounts.set(rootKey, (evictionCounts.get(rootKey) ?? 0) + 1);
}

/** The eviction count of the root a scoped key belongs to. */
export function getRestorationGeneration(key: string) {
  return evictionCounts.get(key.slice(0, key.indexOf('|'))) ?? 0;
}

/** Only a value written before the root's latest eviction is restored, so a remount inside a live tree starts fresh. */
export function readRestorable<T>(store: Map<string, RestorableEntry<T>>, key: string) {
  const entry = store.get(key);
  if (!entry || entry.generation >= getRestorationGeneration(key)) return undefined;
  return entry;
}

/** Re-inserted so the map orders by write recency, which is what the size caps evict by. */
export function writeRestorable<T>(store: Map<string, RestorableEntry<T>>, key: string, value: T, generation = getRestorationGeneration(key)) {
  store.delete(key);
  store.set(key, { value, generation });
}

export type HiddenNode = { isHidden: boolean; parent: HiddenNode | null };

const RestorationHiddenContext = createContext<HiddenNode | null>(null);

/**
 * Marks a subtree an `<Activity>` hides. A hidden subtree runs its effect cleanups as an unmount
 * would, and this is how those cleanups tell the two apart.
 */
export function RestorationHiddenBoundary({ isHidden, children }: { isHidden: boolean; children: React.ReactNode }) {
  const parent = useContext(RestorationHiddenContext);
  const [node] = useState<HiddenNode>(() => ({ isHidden, parent }));
  // Layout phase, so it is set before the passive cleanups the same commit runs for the hidden subtree.
  useLayoutEffect(() => {
    node.isHidden = isHidden;
  }, [node, isHidden]);
  return <RestorationHiddenContext.Provider value={node}>{children}</RestorationHiddenContext.Provider>;
}

export function useRestorationHiddenNode() {
  return useContext(RestorationHiddenContext);
}

export function isRestorationHidden(node: HiddenNode | null) {
  for (let current = node; current; current = current.parent) {
    if (current.isHidden) return true;
  }
  return false;
}

/**
 * Why a restorable instance let go of its key: its subtree was hidden, its root was evicted, or it
 * was removed. Only a removal forgets the value, since nothing is coming back for it.
 */
export function getDetachReason(node: HiddenNode | null, key: string, generationAtAttach: number) {
  if (isRestorationHidden(node)) return 'hidden' as const;
  if (getRestorationGeneration(key) !== generationAtAttach) return 'evicted' as const;
  return 'removed' as const;
}

/** Registered rather than called directly, so this module need not import the modules that keep their own state. */
const testResets: Array<() => void> = [];
export function registerTestReset(reset: () => void) {
  testResets.push(reset);
}

/** Guards against growth from a scope that is never pruned. */
const MAX_ENTRIES = 500;

/** Drops state whose anchor has left the tree. Judged against every reachable place, not the focused one. */
function shouldDrop(storeKey: string, liveKeysByRoot: Record<string, readonly string[]>) {
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
export function pruneRestorableState(liveKeysByRoot: Record<string, readonly string[]>) {
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

const RestorationNamespaceContext = createContext<string>('');

/**
 * Distinguishes sibling renders of one component. Automatic ids come from the call site, so two
 * scenes of a tab view would otherwise share a key and the contention guard would give up on both.
 */
export function RestorationNamespace({ name, children }: { name: string; children: React.ReactNode }) {
  const parent = useContext(RestorationNamespaceContext);
  const value = useMemo(() => (parent ? `${parent}>${name}` : name), [parent, name]);
  return <RestorationNamespaceContext.Provider value={value}>{children}</RestorationNamespaceContext.Provider>;
}

/** The scope this component sits in, as the configured scope hook sees it plus any namespaces around it. */
export function useRestorationScope() {
  const scope = useConfiguredScope();
  const namespace = useContext(RestorationNamespaceContext);
  // Appended past the anchor so pruning still reads the root and anchor keys it judges by.
  return namespace ? `${scope}::${namespace}` : scope;
}

/** `useState`, except the value survives an eviction. `id` need only be unique within its scope. */
export function useRestorableState<T>(id: string, initialValue: T | (() => T)) {
  const key = `${useRestorationScope()}|${id}`;
  const hiddenNode = useRestorationHiddenNode();

  const [value, setValue] = useState<T>(() => {
    const initial = () => (typeof initialValue === 'function' ? (initialValue as () => T)() : initialValue);

    if (!isRestorationEnabled) return initial();
    const entry = readRestorable(restorationStore, key);
    if (entry) {
      restorationCounters.manualRestored += 1;
      reportRestorationOnce('manual-ok', id, () => `[restore-manual-ok] id=${id} key=${key}`);
      return entry.value as T;
    }
    restorationCounters.manualMissed += 1;
    reportRestorationOnce('manual-miss', id, () => `[restore-manual-miss] id=${id} key=${key}`);
    return initial();
  });

  // Written on change, not on unmount, since eviction unmounts without warning.
  useEffect(() => {
    if (!isRestorationEnabled) return;
    writeRestorable(restorationStore, key, value);
    evictOldestIfNeeded();
  }, [key, value]);

  useEffect(() => {
    if (!isRestorationEnabled) return undefined;
    const generation = getRestorationGeneration(key);
    return () => {
      if (getDetachReason(hiddenNode, key, generation) === 'removed') restorationStore.delete(key);
    };
  }, [key, hiddenNode]);

  return [value, setValue] as const;
}

/** Drops everything kept for one root: every anchored scope begins with its key. */
export function forgetRestorableState(rootKey: string) {
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

export function resetRestorationForTests() {
  for (const store of scopedStores) store.clear();
  for (const reset of testResets) reset();
  evictionCounts.clear();
  // Tests are about eviction; a test of the off path opts out with `setRestorationEnabled(false)`.
  isRestorationEnabled = true;
}

/** Seeds a value as written before the root's latest eviction, so it restores. */
export function seedRestorableStateForTests(scope: string, id: string, value: unknown) {
  restorationStore.set(`${scope}|${id}`, { value, generation: -1 });
}

export function hasRestorableStateForTests(scope: string, id: string) {
  return restorationStore.has(`${scope}|${id}`);
}

export function restorableStateSizeForTests() {
  return restorationStore.size;
}
