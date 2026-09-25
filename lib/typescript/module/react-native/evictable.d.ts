import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { EvictionLifecycleOptions } from '../eviction_lifecycle';
export type EvictableProps = Omit<EvictionLifecycleOptions, 'snapshot'> & {
    rootKey: string;
    /**
     * Off, the children stay mounted through an eviction and something inside unmounts instead, by reading
     * `useIsEvicted()` or rendering an `<EvictionGate>` — for a navigator whose state would go with it, say.
     */
    unmountChildren?: boolean;
    /** Experimental. Photographs the content on the way out and covers its rebuild with the picture. */
    snapshot?: {
        place: string;
    };
    /** The style of the view that holds the children, which is the view photographed. Fills the parent by default. */
    style?: StyleProp<ViewStyle>;
    children: React.ReactNode;
};
/**
 * A root that can be evicted: its content unmounts while `evict` is on, and comes back as it was left. Owns when the
 * content actually unmounts, the eviction mark its restorable state depends on, the expiry, and the snapshot.
 */
export declare function Evictable({ rootKey, unmountChildren, snapshot, style, children, ...options }: EvictableProps): import("react/jsx-runtime").JSX.Element;
/** Whether the nearest `<Evictable>` is evicted: what unmounts the content of one whose children stay mounted. */
export declare function useIsEvicted(): boolean;
/** Renders its children except while the nearest `<Evictable>` is evicted. */
export declare function EvictionGate({ children }: {
    children: React.ReactNode;
}): import("react/jsx-runtime").JSX.Element | null;
//# sourceMappingURL=evictable.d.ts.map