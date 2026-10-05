# `@sleeperhq/react-restorable`

Saves the state of a component tree in memory when it unmounts, and puts it back when it mounts again.

```tsx
<Restorable rootKey={tabKey} evict={!isFocused} expireAfterMs={5 * 60 * 1000}>
  <TabContent />
</Restorable>
```

When `evict` turns on, `<TabContent />` unmounts and its `useState` values and scroll positions are saved. When it
turns off, the tree mounts again where the user left it. The components inside don't change: the Babel plugin makes
their `useState` calls restorable.

Only this unmount saves state. Closing a sheet, changing a `key` or any other unmount starts fresh.

## Install

```jsonc
// package.json
"@sleeperhq/react-restorable": "blitzstudios/react-restorable.git#react-restorable-v0.7.0-gitpkg"
```

## Setup

### 1. Add the Babel plugin

Put it after the React Compiler, which needs to see the plain `useState`:

```js
// babel.config.js
plugins: [
  'babel-plugin-react-compiler',
  ['@sleeperhq/react-restorable/babel', {
    include: ['/app/src/'],
    helperHooks: { useMergeState: 'shared/hooks' },
    scrollables: { root: 'AppScrollable' },
  }],
],
```

- `include`: only files under these paths are rewritten.
- `helperHooks`: hooks defined outside `include` that take an initial value, as hook name to import path.
- `scrollables`: tags `<AppScrollable.FlatList />` and the like so their scroll position can be restored.

To opt a call out, put `// @no-restore` on its line or the line above. Files that import `useRestorableState` are
skipped, since they handle restoration themselves.

### 2. Configure it once, before the first render

```ts
import { configureRestorationScope, setRestorationEnabled } from '@sleeperhq/react-restorable';
import { useReactNavigationRestorationScope } from '@sleeperhq/react-restorable/react-navigation';

configureRestorationScope(useReactNavigationRestorationScope);
setRestorationEnabled(readYourFlagOnce());
```

With restoration off, the rewritten code passes each value straight through and costs almost nothing.

### 3. Wrap what you evict

```tsx
import { Restorable } from '@sleeperhq/react-restorable/react-native';

<Restorable
  rootKey={tabKey}
  evict={isLeaving}
  expireAfterMs={5 * 60 * 1000}
  shouldKeep={() => isParkedMidTask} // optional: keep state past the expiry
  expireOnBackground                 // optional: drop state as soon as the app backgrounds
>
  <TabContent />
</Restorable>
```

`<Restorable>` unmounts its children while `evict` is true and gives their state back when they return. State is
dropped after `expireAfterMs`.

If the children have to stay mounted, like a navigator that loses its state on unmount, pass `unmountChildren={false}`
and unmount the content further down with `<EvictionGate>` or `useIsEvicted()`.

In a tab navigator, call `usePruneRestorableState(state)` from `/react-navigation` to drop the state of routes the user
has left.

### 4. Restore scroll positions

```ts
import { withScrollRestoration } from '@sleeperhq/react-restorable/react-native';

export const FlatList = withScrollRestoration(BaseFlatList, 'scrollToOffset');
export const ScrollView = withScrollRestoration(BaseScrollView, 'scrollTo');
```

A list is hidden until it reaches its old offset. If it can't get there within 3 seconds, it shows where it is rather
than jump while the user is reading.

### 5. Optional: show a snapshot while it rebuilds

Experimental. The root is photographed as it's evicted, and the picture covers it while it re-renders on return:

```tsx
// once, at launch
configureRestorationSnapshots({ capture: (view) => captureRef(view, { result: 'tmpfile' }), release: releaseCapture });

// `place` is where the picture belongs; for a tab, the route its state is anchored to
<Restorable rootKey={tab.key} evict={isLeaving} expireAfterMs={5 * 60 * 1000} snapshot={{ place: getAnchorRouteKey(tab) }}>
```

The picture stays up for 600ms after the return and expires with the rest of the state. You supply the capture
function, so the package has no native dependency.

## What gets kept

Values are held in memory, not serialized.

- **Kept:** primitives, arrays, `Set`, `Map` and plain objects, up to 256 nodes. When the initial value is a plain
  object, fields that can't be kept are rebuilt from it.
- **Not kept:** functions, class instances, React elements and anything larger. Those are what eviction is meant to
  free.
- **Repeated components:** two mounted copies at the same call site, such as list rows, can't tell whose value it is,
  so neither gets it. Wrap each in a `RestorationNamespace`. The scroll wrapper already does this for list rows.
- **`<Activity>`:** it runs cleanups when it hides a subtree. Wrap it in a `RestorationHiddenBoundary` to keep the
  hidden subtree's state.

## API

| export | use |
| --- | --- |
| `configureRestorationScope`, `setRestorationEnabled` | setup, once |
| `<Restorable>`, `<EvictionGate>`, `useIsEvicted()` | evicting a root, and unmounting inside one whose children stay mounted |
| `useEvictionLifecycle(root, options)` | `<Restorable>` as a hook, for a host that renders its own view |
| `usePruneRestorableState`, `pruneRestorableState` | dropping state for places the user has left |
| `markEvicted`, `forgetRestorableState` | managing a root's state by hand |
| `useRestorableState(id, initial)` | restoring one value explicitly |
| `RestorationNamespace`, `RestorationHiddenBoundary` | repeated components and `<Activity>`, as above |
| `withScrollRestoration` | scroll positions |
| `configureRestorationSnapshots`, `discardRestorationSnapshots` | snapshots (experimental) |
| `setRestorationDebugEnabled`, `getRestorationStats`, `reportRestorationStats`, `getRestoredChangedSites` | debugging: what restored, what was refused, and which restores changed anything |
| `useRestorationFrame`, `useAutoState`, `useHookRestorationFrame`, `enterComponentHookCall`, `enterHookCall`, `exitHookCall` | what the Babel plugin inserts; not for direct use |

| entry | contains |
| --- | --- |
| `@sleeperhq/react-restorable` | the core; React only |
| `…/react-navigation` | `useReactNavigationRestorationScope`, `usePruneRestorableState`, `getAnchorRouteKey` and helpers |
| `…/react-native` | `Restorable`, `EvictionGate`, `useIsEvicted`, `withScrollRestoration` |
| `…/babel` | the Babel plugin |
| `…/testing` | seeding and resetting state in your own tests |
