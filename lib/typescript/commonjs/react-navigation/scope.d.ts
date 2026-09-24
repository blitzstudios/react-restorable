/**
 * Scopes restoration to where a component sits in React Navigation. The root is the focused route of
 * the nearest tab navigator, which is what eviction unmounts, and the anchor is the route in that
 * tab's own stack, which survives eviction.
 *
 * The key cannot be a nested route key (eviction destroys nested navigators and React Navigation
 * reissues their keys) nor route names alone (two leagues share `LeaguesDetailScreen > Screen`), so it
 * is the anchor's key and identity params, then the names of the routes below it.
 */
type NavRoute = {
    key: string;
    name: string;
    params?: Record<string, unknown>;
    state?: {
        key?: string;
    };
};
export type NavState = {
    key?: string;
    type?: string;
    index?: number;
    routes?: readonly NavRoute[];
};
/** Builds `tabKey|anchorKey|identity|name>name`, outermost first, from each navigator's state with its index on this component's path. */
export declare function computeRestorationScope(states: readonly (NavState | undefined)[]): string;
/**
 * The scope hook to hand `configureRestorationScope`. Reads the contexts rather than `useNavigation()`,
 * which throws outside a navigator, and computes the scope once per screen rather than once per render.
 */
export declare function useReactNavigationRestorationScope(): string;
/**
 * Every route key still reachable under each tab, the tab's own key first — what `pruneRestorableState`
 * takes. Every reachable route rather than the focused path: a screen pushed over another does not invalidate it.
 */
export declare function collectLiveRouteKeys(tabState: {
    routes?: readonly {
        key: string;
        state?: unknown;
    }[];
} | undefined): Record<string, readonly string[]>;
export {};
//# sourceMappingURL=scope.d.ts.map