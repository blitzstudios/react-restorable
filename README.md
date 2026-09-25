# `@sleeperhq/react-restorable`

State that survives its tree being unmounted. When a screen you left is evicted — unmounted to give its memory
back — and later rebuilt, its components' `useState` values and its lists' scroll positions come back as you left
them.

```tsx
// Written as usual. The Babel plugin makes it restorable.
const [position, setPosition] = useState('ALL');
```

Keeping a hidden screen mounted (`react-freeze`, `<Activity>`) keeps everything — fibers, native views,
closures, fetched payloads — which is exactly the memory you wanted back. Unmounting releases all of it and loses
the state with it. This keeps the small part a user notices, and only that.

## Concepts

| term | what it is |
| --- | --- |
| **scope** | where a component sits, as `root\|anchor\|…`. It comes from a scope hook you configure, such as `useReactNavigationRestorationScope`. A scope starting `unanchored\|` never restores |
| **root** | the tree an eviction unmounts as a whole: a bottom tab, say. `markEvicted` and `forgetRestorableState` take a root key |
| **anchor** | the place inside a root whose departure makes its state stale: the route in a tab's own stack. `pruneRestorableState` judges by it |
| **eviction** | unmounting a root to release it, marked with `markEvicted` before its cleanups run. **Only an eviction carries state over**: a closed sheet, a changed `key` or any other remount starts fresh |
| **frame** | what the Babel plugin gives each function that calls a state hook. It hands each hook its restored initial value on the way back, records what it rendered, and snapshots it once, as the root is evicted |

## What is kept

Values are held by reference, never serialized, so "restorable" means safe and cheap to hold:

- **Kept:** primitives, arrays, `Set`, `Map` and plain objects, up to 256 nodes. A plain object keeps its restorable
  fields and rebuilds the rest from the initial value, so one `Animated.Value` does not cost the selections beside it.
- **Dropped:** functions, class instances, React elements, and anything larger — which is what keeps this from
  retaining the handles and payloads the eviction exists to release.
- **Refused:** a key held by two live instances at once, such as a row a list renders many times from one call site.
  Neither is the one that left the value, so neither gets it. Wrap each in a `RestorationNamespace` to tell them apart;
  the scroll wrapper does this per row from the list's `keyExtractor`.

A subtree an `<Activity>` hides runs its cleanups as if unmounted. Wrap the `<Activity>` in a
`RestorationHiddenBoundary` so a hidden subtree keeps its value across an eviction.

## Install

```jsonc
// package.json
"@sleeperhq/react-restorable": "blitzstudios/react-restorable.git#react-restorable-v0.3.0-gitpkg"
```

## Setup

**1. The transform**, after React Compiler, which has to see the plain `useState`:

```js
// babel.config.js
plugins: [
  'babel-plugin-react-compiler',
  ['@sleeperhq/react-restorable/babel', {
    include: ['/app/src/'],                        // only files under here
    helperHooks: { useMergeState: 'hook_helper' }, // other hooks that take an initial value, by import source
    scrollables: { root: 'AppScrollable' },        // tag <AppScrollable.FlatList /> and friends with an id
  }],
],
```

Opt a call out with `// @no-restore` on its line or the line above. A file that imports the package itself is left
alone, on the grounds that it manages its own restoration.

**2. Once, before anything renders**, because frames call hooks only while restoration is on:

```ts
import { configureRestorationScope, setRestorationEnabled } from '@sleeperhq/react-restorable';
import { useReactNavigationRestorationScope } from '@sleeperhq/react-restorable/react-navigation';

configureRestorationScope(useReactNavigationRestorationScope);
setRestorationEnabled(readYourFlagOnce());
```

Off, a frame calls no hooks and hands each hook its own argument back, so the transform costs close to nothing.

**3. Where you evict**, in the component that decides whether the root's tree is mounted:

```tsx
const { isEvicted } = useEvictionLifecycle(tabKey, {
  evict: isLeaving,                  // whether the root should go
  expireAfterMs: 5 * 60 * 1000,      // how long an evicted root keeps what it left
  shouldKeep: () => isParkedMidTask, // optional: keep state past the expiry
});

return isEvicted ? null : <TabContent />;
```

Unmount on `isEvicted`, not on your own flag: a snapshot, below, holds the unmount until its picture is taken.

It marks the eviction in the layout phase, before the unmounted tree's cleanups, which is how they tell an eviction
from a removal; a mark from an ordinary effect lands too late and nothing restores. The expiry is checked on the way
back in as well as on a timer, since timers do not run while the app is backgrounded. The lower-level
`markEvicted` and `forgetRestorableState` are there for a host that cannot use the hook.

Drop what has gone stale as navigation moves with `pruneRestorableState(collectLiveRouteKeys(tabNavigatorState))`.

**4. Optionally, a picture over the rebuild.** Experimental. Restored state lands the tree where it was left, but it
still has to render, so the root can be photographed on the way out and covered with the picture while it rebuilds:

```tsx
// once, at launch
configureRestorationSnapshots({ capture: (view) => captureRef(view, { result: 'tmpfile' }), release: releaseCapture });

// where you evict
const { isEvicted, snapshotUri } = useEvictionLifecycle(tabKey, {
  evict: isLeaving,
  expireAfterMs: 5 * 60 * 1000,
  snapshot: { place: activeRouteKey, viewRef: contentRef }, // where in the root the picture was taken
});
```

Render `snapshotUri` over the root whenever it is set, and keep that overlay mounted for the whole eviction: a switch that
animates on the UI thread starts before a newly mounted image paints. The picture is this eviction's, never an older
one, and never one of a place the root has since left; it holds for 600ms after the return, and goes with the rest
of the root's state at the expiry. Capture is injected, so the package takes no native dependency — the example uses
`react-native-view-shot`. `discardRestorationSnapshots(root)` drops a root's pictures by hand.

**5. Scroll positions**, by wrapping each scrollable once:

```ts
import { withScrollRestoration } from '@sleeperhq/react-restorable/react-native';

export const FlatList = withScrollRestoration(BaseFlatList, 'scrollToOffset');
export const ScrollView = withScrollRestoration(BaseScrollView, 'scrollTo');
```

A plain scroll view is created at its offset. A virtualized list holds its first paint off screen until its content
is long enough to scroll to the offset, then applies it.

## API

| export | what it is for |
| --- | --- |
| `useRestorableState(id, initial)` | explicit restoration for one value, `id` unique within its scope; what the transform does implicitly |
| `useRestorationFrame(id)` / `useAutoState(id, initial)` | the frame the transform injects, and its single-`useState` form |
| `RestorationNamespace` | tells apart sibling renders of one component |
| `RestorationHiddenBoundary` | marks a subtree an `<Activity>` hides |
| `useEvictionLifecycle(root, options)` | when a root's tree unmounts, the eviction mark its state depends on, when what it left is forgotten, and optionally the picture over its rebuild |
| `configureRestorationSnapshots(capture)`, `discardRestorationSnapshots(root)` | experimental: how pictures are taken and deleted, and dropping a root's pictures by hand |
| `markEvicted(root)`, `forgetRestorableState(root)`, `pruneRestorableState(liveKeysByRoot)` | the lifetime of what is kept, by hand |
| `configureRestorationScope(useScope)`, `setRestorationEnabled(on)` | setup, once, before the first render |
| `getRestorationStats()`, `getRestoredChangedSites()` | what restored, and which call sites brought back something other than their initial value — the measure of whether the transform earns its keep |
| `setRestorationDebugEnabled(on)`, `reportRestorationStats()` | console reporting of refusals and misses, and a one-line summary with the call sites whose restores mattered |

| entry | holds |
| --- | --- |
| `@sleeperhq/react-restorable` | everything above; React only |
| `…/react-navigation` | `useReactNavigationRestorationScope`, `computeRestorationScope`, `collectLiveRouteKeys` |
| `…/react-native` | `withScrollRestoration` |
| `…/babel` | the transform |
| `…/testing` | seeding and resetting the stores, for a consumer's own tests |

Each subpath is declared twice — in `exports`, and as a stub `package.json` beside `lib/` — because TypeScript and
Metro still resolve the way Node did before `exports` existed.

**`lib/` is committed.** Consumers install with `enableScripts: false`, so a gitpkg install never runs `prepare`;
a change to `src/` is not published until `yarn build` runs and the output is committed and tagged.
