import { RestorableEntry } from './restorable_state';
/**
 * Whether a value can be held across an unmount. Rejects functions and symbols (a stale closure
 * outlives the tree it captured), class instances, React elements, and anything past the budget.
 */
export declare function isRestorable(value: unknown): boolean;
export declare function getRestorationStats(): {
    values: number;
    contended: number;
    live: number;
    refusedUnanchoredIdsDistinct: number;
    refusedContendedKeysDistinct: number;
    restoredChangedSitesDistinct: number;
    manualRestored: number;
    manualMissed: number;
    pruned: number;
    restored: number;
    restoredChanged: number;
    missed: number;
    refusedUnanchored: number;
    refusedContended: number;
    evicted: number;
};
/** The call sites whose restores most often brought back something other than the initial value. */
export declare function getRestoredChangedSites(limit?: number): [string, number][];
/**
 * The scope to key by, or null when this component must not restore at all. Owns the key's entry in
 * `store`: forgotten when the component is removed or the key is contended, and handed to `onDetach`
 * when it is hidden or evicted, with the generation to write under.
 */
export declare function useScopedKey(id: string, store: Map<string, RestorableEntry<any>>, enabled: boolean, onDetach?: (key: string, generation: number) => void): string | null;
/** The surface the transform calls into, shared by the live frame and the inert one. */
export type RestorationFrameApi = {
    /**
     * What to pass the hook as its initial value: what the tab left behind on a restoring mount, and `init` itself the
     * rest of the time, so the call allocates nothing it did not already.
     */
    initial<T>(slot: number, init: T | (() => T)): T | (() => T);
    /** Records what a slot rendered and passes the hook's result through untouched. */
    state<Tuple extends readonly unknown[]>(slot: number, tuple: Tuple): Tuple;
};
/**
 * One per function that calls a state hook, injected by the transform. The gate is read once per
 * launch, so with eviction off this calls no hooks at all and the frame costs nothing.
 */
export declare function useRestorationFrame(frameId: string): RestorationFrameApi;
/** What the transform emits for a component with a single `useState`. */
export declare function useAutoState<T>(id: string, initialValue: T | (() => T)): [T, import("react").Dispatch<import("react").SetStateAction<T>>];
//# sourceMappingURL=auto_restorable.d.ts.map