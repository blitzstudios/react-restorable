export type EvictionLifecycleOptions = {
    /** Whether the root's tree is unmounted right now. Pass what actually unmounts it, in the same render. */
    isEvicted: boolean;
    /** How long an evicted root keeps what it left behind before it is forgotten. */
    expireAfterMs: number;
    /** Off, nothing is marked or forgotten. */
    enabled?: boolean;
    /** Keeps the root's state past the expiry while it returns true, such as for a tab parked mid-task. */
    shouldKeep?: () => boolean;
    /** Runs whenever the root expires, kept or not: for whatever else the app holds for it, such as a snapshot. */
    onExpire?: () => void;
};
/**
 * Marks a root evicted as its tree unmounts, and forgets what it left once it has been away past
 * `expireAfterMs`. The mark lands in the layout phase, before the unmounted tree's passive cleanups,
 * which is how those cleanups tell an eviction from a removal.
 *
 * The expiry is checked while rendering the root's return as well as on a timer, since a JS timer
 * does not run while the app is backgrounded, and the returning tree reads what was kept from its
 * state initializers in the same commit — so an effect would run too late.
 */
export declare function useEvictionLifecycle(rootKey: string, { isEvicted, expireAfterMs, enabled, shouldKeep, onExpire }: EvictionLifecycleOptions): void;
//# sourceMappingURL=eviction_lifecycle.d.ts.map