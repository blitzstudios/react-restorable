export type EvictionLifecycleOptions = {
    /** Whether the root should be evicted. Its tree unmounts once `isEvicted` says so, which a snapshot can delay. */
    evict: boolean;
    /** How long an evicted root keeps what it left behind, its pictures included, before it is forgotten. */
    expireAfterMs: number;
    /** Off, nothing is marked, photographed or forgotten, and `isEvicted` follows `evict`. */
    enabled?: boolean;
    /** Keeps the root's state past the expiry while it returns true, such as for a tab parked mid-task. */
    shouldKeep?: () => boolean;
    /** Runs whenever the root expires, kept or not: for whatever else the host holds for it. */
    onExpire?: () => void;
    /**
     * Experimental. Photographs `viewRef` on the way out and hands the picture back as `snapshotUri` while the root
     * rebuilds. `place` is where in the root it was taken, so a root that moved on is not shown as somewhere it no
     * longer is. Inert until `configureRestorationSnapshots` is called.
     */
    snapshot?: {
        place: string;
        viewRef: {
            current: unknown;
        };
    };
};
export type EvictionLifecycle = {
    /** Whether to unmount the root's tree now. */
    isEvicted: boolean;
    /** The picture to cover the root with, while it is evicted and for a moment after it returns. */
    snapshotUri: string | undefined;
};
/**
 * The lifecycle of an evictable root: when its tree actually unmounts, the eviction mark its restorable state depends
 * on, when what it left is forgotten, and, optionally, the picture that covers its rebuild.
 */
export declare function useEvictionLifecycle(rootKey: string, { evict, expireAfterMs, enabled, shouldKeep, onExpire, snapshot }: EvictionLifecycleOptions): EvictionLifecycle;
//# sourceMappingURL=eviction_lifecycle.d.ts.map