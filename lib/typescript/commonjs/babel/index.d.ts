import type { PluginObj, types as BabelTypes } from '@babel/core';
/**
 * Makes component state restorable across an eviction, and tags scrollable JSX call sites with a
 * stable id; the runtime decides at render time what is worth keeping.
 *
 * Each function that calls a state hook gets one restoration frame, and each call takes its initial
 * value through it and reports what it rendered:
 *
 *   const _restore = useRestorationFrame("src/screens/example#0");
 *   const [round, setRound] = _restore.state(0, useState(_restore.initial(0, leg)));
 *
 * `initial` hands back `leg` itself except on a restoring mount, so the call allocates nothing extra.
 *
 * Run it after React Compiler, which recognizes `useState` by name and has to see the plain hook.
 * Opt a call or element out with `// @no-restore` on its line or the line above.
 */
export type RestorableBabelOptions = {
    /** Where `useRestorationFrame` is imported from, and the import that marks a file as restoring its own state. */
    runtimeModule?: string;
    /** A file is rewritten only when its path contains one of these. Unset, every file outside `node_modules` is. */
    include?: string[];
    /** Paths never rewritten, on top of `node_modules`, tests and mocks. */
    exclude?: string[];
    /** Hooks from other modules that take an initial value the way `useState` does: name to a substring of the import source. */
    helperHooks?: Record<string, string>;
    /** Scrollables whose call sites get a `__restoreId`, written `<Root.Component>` or `<Root.Qualifier.Component>`. */
    scrollables?: {
        root: string;
        components?: string[];
        qualifiers?: string[];
    };
    /** The pragma that opts a call or element out. */
    optOut?: string;
};
export default function restorableBabelPlugin({ types: t }: {
    types: typeof BabelTypes;
}, options?: RestorableBabelOptions): PluginObj;
//# sourceMappingURL=index.d.ts.map