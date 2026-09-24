import React from 'react';
/**
 * Component state that survives its tree being evicted, keyed so it returns to the place it was left.
 * Only an eviction carries state over: any other remount starts fresh.
 *
 * Everything is keyed by a scope, `root|anchor|…`. The root is the tree an eviction unmounts as a
 * whole, a bottom tab say, and is what `markEvicted` and `forgetRestorableState` take. The anchor is
 * the place inside it whose departure makes its state stale, and is what `pruneRestorableState`
 * judges. A scope starting `unanchored|` never restores.
 */
export declare const UNANCHORED_SCOPE_PREFIX = "unanchored|";
/**
 * Set once, before anything renders, and never again: restoration frames call hooks only while it is
 * on, so it must not change under a mounted component. Off, the layer costs nothing.
 */
export declare function setRestorationEnabled(enabled: boolean): void;
export declare function getIsRestorationEnabled(): boolean;
/**
 * The hook that says which scope a component sits in, such as `useReactNavigationRestorationScope`.
 * Set once, before anything renders, since it is called as a hook. Unset, nothing is anchored.
 */
export declare function configureRestorationScope(useScope: () => string): void;
export declare const restorationCounters: {
    manualRestored: number;
    manualMissed: number;
    pruned: number;
};
/**
 * Whether restoration reports anything to the console. Off by default: a refusal is the layer declining to restore
 * rather than a fault, and the counters move on every navigation, so left on they are a per-navigation summary of
 * something working as designed.
 */
export declare function setRestorationDebugEnabled(enabled: boolean): void;
export declare function getIsRestorationDebugEnabled(): boolean;
export declare function reportRestorationOnce(kind: string, dedupeOn: string, message: () => string): void;
/** `generation` is the owning root's eviction count when the value was written. */
export type RestorableEntry<T = unknown> = {
    value: T;
    generation: number;
};
export declare function registerScopedStore(store: Map<string, RestorableEntry<any>>): void;
/** Called as a root's tree unmounts for an eviction, before its effect cleanups run: from a layout effect, say. */
export declare function markEvicted(rootKey: string): void;
/** The eviction count of the root a scoped key belongs to. */
export declare function getRestorationGeneration(key: string): number;
/** Only a value written before the root's latest eviction is restored, so a remount inside a live tree starts fresh. */
export declare function readRestorable<T>(store: Map<string, RestorableEntry<T>>, key: string): RestorableEntry<T> | undefined;
/** Re-inserted so the map orders by write recency, which is what the size caps evict by. */
export declare function writeRestorable<T>(store: Map<string, RestorableEntry<T>>, key: string, value: T, generation?: number): void;
export type HiddenNode = {
    isHidden: boolean;
    parent: HiddenNode | null;
};
/**
 * Marks a subtree an `<Activity>` hides. A hidden subtree runs its effect cleanups as an unmount
 * would, and this is how those cleanups tell the two apart.
 */
export declare function RestorationHiddenBoundary({ isHidden, children }: {
    isHidden: boolean;
    children: React.ReactNode;
}): import("react/jsx-runtime").JSX.Element;
export declare function useRestorationHiddenNode(): HiddenNode | null;
export declare function isRestorationHidden(node: HiddenNode | null): boolean;
/**
 * Why a restorable instance let go of its key: its subtree was hidden, its root was evicted, or it
 * was removed. Only a removal forgets the value, since nothing is coming back for it.
 */
export declare function getDetachReason(node: HiddenNode | null, key: string, generationAtAttach: number): "hidden" | "evicted" | "removed";
export declare function registerTestReset(reset: () => void): void;
/**
 * Drops state whose anchor is no longer reachable. `liveKeysByRoot` maps each root to every anchor key
 * still under it, the root's own key first; a root missing from it is gone entirely.
 */
export declare function pruneRestorableState(liveKeysByRoot: Record<string, readonly string[]>): void;
/**
 * Distinguishes sibling renders of one component. Automatic ids come from the call site, so two
 * scenes of a tab view would otherwise share a key and the contention guard would give up on both.
 */
export declare function RestorationNamespace({ name, children }: {
    name: string;
    children: React.ReactNode;
}): import("react/jsx-runtime").JSX.Element;
/** The scope this component sits in, as the configured scope hook sees it plus any namespaces around it. */
export declare function useRestorationScope(): string;
/** `useState`, except the value survives an eviction. `id` need only be unique within its scope. */
export declare function useRestorableState<T>(id: string, initialValue: T | (() => T)): readonly [T, React.Dispatch<React.SetStateAction<T>>];
/** Drops everything kept for one root: every anchored scope begins with its key. */
export declare function forgetRestorableState(rootKey: string): number;
export declare function resetRestorationForTests(): void;
/** Seeds a value as written before the root's latest eviction, so it restores. */
export declare function seedRestorableStateForTests(scope: string, id: string, value: unknown): void;
export declare function hasRestorableStateForTests(scope: string, id: string): boolean;
export declare function restorableStateSizeForTests(): number;
//# sourceMappingURL=restorable_state.d.ts.map