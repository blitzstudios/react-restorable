import React, { Activity, useState } from 'react';
import { act } from 'react-test-renderer';
import { getRestorationStats, getRestoredChangedSites, isRestorable, useAutoState, useRestorationFrame } from '../auto_restorable';
import { RestorationHiddenBoundary, RestorationNamespace, markEvicted, resetRestorationForTests, setRestorationEnabled } from '../restorable_state';
import { InTab, Text, Unholdable, render, renderHook } from './render';

beforeEach(() => {
  resetRestorationForTests();
});

/** Unmounts the way an eviction does: the root is marked before its tree's cleanups run. */
function evict(...views: { unmount: () => void }[]) {
  markEvicted('tab-1');
  views.forEach((view) => view.unmount());
}

const wrapper = InTab;

describe('isRestorable', () => {
  it('accepts the shapes user selections actually take', () => {
    expect(isRestorable('ALL')).toBe(true);
    expect(isRestorable(3)).toBe(true);
    expect(isRestorable(false)).toBe(true);
    expect(isRestorable(null)).toBe(true);
    expect(isRestorable(undefined)).toBe(true);
    expect(isRestorable({ round: 3, positionFilter: 'QB', teamFilter: null })).toBe(true);
    expect(isRestorable(['nfl', 'nba'])).toBe(true);
    expect(isRestorable(new Set(['nfl']))).toBe(true);
    expect(isRestorable(new Map([['nfl', true]]))).toBe(true);
  });

  it('rejects what would break or defeat the feature', () => {
    expect(isRestorable(new Unholdable(0))).toBe(false);
    expect(isRestorable(() => undefined)).toBe(false);
    expect(isRestorable(React.createElement('div'))).toBe(false);
    expect(isRestorable(Symbol('x'))).toBe(false);
    expect(isRestorable({ onPress: () => undefined })).toBe(false);

    class Subscription {
      active = true;
    }
    expect(isRestorable(new Subscription())).toBe(false);
  });

  it('rejects anything past the node budget, so a fetched payload is never held', () => {
    expect(isRestorable(Array.from({ length: 100 }, (_unused, index) => index))).toBe(true);
    expect(isRestorable(Array.from({ length: 5000 }, (_unused, index) => index))).toBe(false);
  });

  it('tolerates a cycle rather than hanging on it', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(isRestorable(cyclic)).toBe(true);
  });
});

describe('useAutoState', () => {
  it('keeps nothing when tabs are not being evicted', () => {
    setRestorationEnabled(false);

    const first = renderHook(() => useAutoState('filter', 'ALL'), { wrapper });
    act(() => first.result.current[1]('QB'));
    first.unmount();

    const second = renderHook(() => useAutoState('filter', 'ALL'), { wrapper });
    expect(second.result.current[0]).toBe('ALL');
    expect(getRestorationStats().refusedUnanchored).toBe(0);
  });

  it('comes back with the last value after an eviction', () => {
    const first = renderHook(() => useAutoState('filter', 'ALL'), { wrapper });
    act(() => first.result.current[1]('QB'));
    expect(first.result.current[0]).toBe('QB');
    evict(first);

    const second = renderHook(() => useAutoState('filter', 'ALL'), { wrapper });
    expect(second.result.current[0]).toBe('QB');
  });

  it('starts fresh when remounted inside a live tab', () => {
    const first = renderHook(() => useAutoState('filter', 'ALL'), { wrapper });
    act(() => first.result.current[1]('QB'));
    first.unmount();

    expect(renderHook(() => useAutoState('filter', 'ALL'), { wrapper }).result.current[0]).toBe('ALL');
  });

  it('starts fresh when a new key replaces the instance, which is how a component is reset', () => {
    function Draft({ seed }: { seed: string }) {
      const [value] = useAutoState('draft', seed);
      return <Text testID="draft">{value}</Text>;
    }
    const view = render(
      <InTab>
        <Draft key="user-1" seed="user-1-draft" />
      </InTab>,
    );
    view.rerender(
      <InTab>
        <Draft key="user-2" seed="user-2-draft" />
      </InTab>,
    );
    expect(view.textOf('draft')).toBe('user-2-draft');
  });

  it('does not bring back a value whose component was removed before the eviction', () => {
    let setOpen: (open: boolean) => void = () => undefined;
    let setDraft: (draft: string) => void = () => undefined;
    function Sheet() {
      const [draft, set] = useAutoState('sheet', 'fresh');
      setDraft = set;
      return <Text testID="sheet">{draft}</Text>;
    }
    function Screen() {
      const [open, set] = useState(true);
      setOpen = set;
      return open ? <Sheet /> : null;
    }

    const view = render(
      <InTab>
        <Screen />
      </InTab>,
    );
    act(() => setDraft('typed'));
    act(() => setOpen(false));
    evict(view);

    const next = render(
      <InTab>
        <Screen />
      </InTab>,
    );
    expect(next.textOf('sheet')).toBe('fresh');
  });

  it('keeps the value of a subtree that was hidden rather than removed when the tab was evicted', () => {
    let setDraft: (draft: string) => void = () => undefined;
    function Scene() {
      const [draft, set] = useAutoState('scene', 'fresh');
      setDraft = set;
      return <Text testID="scene">{draft}</Text>;
    }
    const tree = (isHidden: boolean) => (
      <InTab>
        <RestorationHiddenBoundary isHidden={isHidden}>
          <Activity mode={isHidden ? 'hidden' : 'visible'}>
            <Scene />
          </Activity>
        </RestorationHiddenBoundary>
      </InTab>
    );

    const view = render(tree(false));
    act(() => setDraft('typed'));
    view.rerender(tree(true));
    evict(view);

    expect(render(tree(false)).textOf('scene')).toBe('typed');
  });

  it('forgets a subtree that was hidden and shown again once it is removed', () => {
    let setDraft: (draft: string) => void = () => undefined;
    function Scene() {
      const [draft, set] = useAutoState('scene', 'fresh');
      setDraft = set;
      return <Text testID="scene">{draft}</Text>;
    }
    const tree = (isHidden: boolean) => (
      <InTab>
        <RestorationHiddenBoundary isHidden={isHidden}>
          <Activity mode={isHidden ? 'hidden' : 'visible'}>
            <Scene />
          </Activity>
        </RestorationHiddenBoundary>
      </InTab>
    );

    const view = render(tree(false));
    act(() => setDraft('typed'));
    view.rerender(tree(true));
    view.rerender(tree(false));
    view.unmount();
    markEvicted('tab-1');

    expect(render(tree(false)).textOf('scene')).toBe('fresh');
  });

  it('keeps the fields of a bundled object it can hold, and rebuilds the rest', () => {
    const makeInitial = () => ({
      positionFilter: 'ALL',
      showAvailableOnly: false,
      placeholderOpacity: new Unholdable(1),
      xOffset: new Unholdable(0),
    });

    const first = renderHook(() => useAutoState('filters', makeInitial), { wrapper });
    act(() => first.result.current[1]((prev) => ({ ...prev, positionFilter: 'QB', showAvailableOnly: true })));
    evict(first);

    const second = renderHook(() => useAutoState('filters', makeInitial), { wrapper });
    expect(second.result.current[0].positionFilter).toBe('QB');
    expect(second.result.current[0].showAvailableOnly).toBe(true);
    expect(second.result.current[0].placeholderOpacity).toBeInstanceOf(Unholdable);
  });

  it('does not hold a bundled object whose every field is unholdable', () => {
    const makeInitial = () => ({ anim: new Unholdable(1) });
    const first = renderHook(() => useAutoState('all-ephemeral', makeInitial), { wrapper });
    evict(first);
    const second = renderHook(() => useAutoState('all-ephemeral', makeInitial), { wrapper });
    expect(second.result.current[0].anim).toBeInstanceOf(Unholdable);
  });

  it('falls back to the initializer when the value is not worth holding', () => {
    const animated = new Unholdable(1);
    const first = renderHook(() => useAutoState<unknown>('anim', null), { wrapper });
    act(() => first.result.current[1](animated));
    evict(first);

    const second = renderHook(() => useAutoState<unknown>('anim', null), { wrapper });
    expect(second.result.current[0]).toBeNull();
  });

  it('keeps ids apart', () => {
    const both = renderHook(() => [useAutoState('a', 1), useAutoState('b', 2)] as const, { wrapper });
    act(() => both.result.current[0][1](9));
    evict(both);

    const next = renderHook(() => [useAutoState('a', 1), useAutoState('b', 2)] as const, { wrapper });
    expect(next.result.current[0][0]).toBe(9);
    expect(next.result.current[1][0]).toBe(2);
  });
});

describe('scope safety', () => {
  it('does not restore outside a tab, where there is no eviction and no stable anchor', () => {
    const first = renderHook(() => useAutoState('filter', 'ALL'));
    act(() => first.result.current[1]('QB'));
    evict(first);

    const second = renderHook(() => useAutoState('filter', 'ALL'));
    expect(second.result.current[0]).toBe('ALL');
  });

  it('stops restoring a key once two instances hold it at the same time', () => {
    // The transform ids by call site, so every row of a list shares one id.
    const rows = renderHook(() => [useAutoState('row', 'a'), useAutoState('row', 'a')] as const, { wrapper });
    act(() => rows.result.current[0][1]('changed'));
    evict(rows);

    const later = renderHook(() => useAutoState('row', 'a'), { wrapper });
    expect(later.result.current[0]).toBe('a');
  });

  it('does not hand the last holder of a contended key to every instance that comes back', () => {
    const rows = renderHook(() => [useAutoState('row', 'row-a'), useAutoState('row', 'row-b')] as const, { wrapper });
    evict(rows);

    const later = renderHook(() => [useAutoState('row', 'row-x'), useAutoState('row', 'row-y')] as const, { wrapper });
    expect(later.result.current[0][0]).toBe('row-x');
    expect(later.result.current[1][0]).toBe('row-y');
  });

  it('restores a key again once the instances that contended for it are gone', () => {
    const rows = renderHook(() => [useAutoState('transient', 'a'), useAutoState('transient', 'a')] as const, { wrapper });
    rows.unmount();

    const solo = renderHook(() => useAutoState('transient', 'a'), { wrapper });
    act(() => solo.result.current[1]('changed'));
    evict(solo);

    expect(renderHook(() => useAutoState('transient', 'a'), { wrapper }).result.current[0]).toBe('changed');
  });

  it('still restores a key only ever held by one instance at a time', () => {
    const first = renderHook(() => useAutoState('solo', 'a'), { wrapper });
    act(() => first.result.current[1]('changed'));
    evict(first);

    const second = renderHook(() => useAutoState('solo', 'a'), { wrapper });
    expect(second.result.current[0]).toBe('changed');
  });
});

describe('restoration frames', () => {
  /** What the transform emits for a component with two `useState` calls and a `useMergeState`. */
  function useScreenState(merge: { round: number }) {
    const frame = useRestorationFrame('screen#0');
    const [week, setWeek] = frame.state(0, useState(frame.initial(0, 1)));
    const [position, setPosition] = frame.state(1, useState(frame.initial(1, 'ALL')));
    const [merged] = frame.state(2, useState(frame.initial(2, merge)));
    return { week, setWeek, position, setPosition, merged };
  }

  it('restores every slot of a frame on its own', () => {
    const first = renderHook(() => useScreenState({ round: 1 }), { wrapper });
    act(() => first.result.current.setWeek(7));
    evict(first);

    const second = renderHook(() => useScreenState({ round: 1 }), { wrapper });
    expect(second.result.current.week).toBe(7);
    expect(second.result.current.position).toBe('ALL');
  });

  it('holds nothing while the tab is live, and takes its snapshot as the tab is evicted', () => {
    const view = renderHook(() => useScreenState({ round: 1 }), { wrapper });
    act(() => view.result.current.setWeek(7));
    expect(getRestorationStats().values).toBe(0);

    evict(view);
    expect(getRestorationStats().values).toBe(1);
  });

  it('only consults the store on mount for a hook that re-reads its argument every render', () => {
    const first = renderHook(({ round }) => useScreenState({ round }), { wrapper, initialProps: { round: 1 } });
    evict(first);

    const second = renderHook(({ round }) => useScreenState({ round }), { wrapper, initialProps: { round: 1 } });
    const before = getRestorationStats();
    second.rerender({ round: 2 });
    second.rerender({ round: 3 });
    expect(getRestorationStats().restored).toBe(before.restored);
    expect(getRestorationStats().missed).toBe(before.missed);
  });

  it('is one shared inert frame, calling no hooks, when tabs are not being evicted', () => {
    setRestorationEnabled(false);
    const a = renderHook(() => useRestorationFrame('a#0'), { wrapper });
    const b = renderHook(() => useRestorationFrame('b#0'), { wrapper });
    expect(a.result.current).toBe(b.result.current);
  });

  it('hands back the initial value itself when there is nothing to restore, so nothing is allocated', () => {
    const initializer = () => 'initial';
    const record = { round: 1 };

    setRestorationEnabled(false);
    const inert = renderHook(() => useRestorationFrame('inert#0'), { wrapper });
    expect(inert.result.current.initial(0, initializer)).toBe(initializer);
    expect(inert.result.current.initial(1, record)).toBe(record);

    setRestorationEnabled(true);
    const live = renderHook(() => useRestorationFrame('live#0'), { wrapper });
    expect(live.result.current.initial(0, initializer)).toBe(initializer);
    expect(live.result.current.initial(1, record)).toBe(record);
  });

  it('still honours a lazy initializer that is not restoring', () => {
    let calls = 0;
    const view = renderHook(() => useAutoState('lazy#0', () => {
      calls += 1;
      return 'computed';
    }), { wrapper });
    view.rerender(undefined);
    view.rerender(undefined);

    expect(view.result.current[0]).toBe('computed');
    expect(calls).toBe(1);
  });

  it('keeps a function held in state as a function, rather than calling it as an initializer', () => {
    const handler = () => 'handled';
    const view = renderHook(() => useAutoState<() => string>('fn#0', () => handler), { wrapper });
    expect(view.result.current[0]).toBe(handler);
  });
});

describe('restored-and-changed counter', () => {
  it('counts a restore that brings back something other than the initial value, by call site', () => {
    const first = renderHook(() => useAutoState('filter#0', 'ALL'), { wrapper });
    act(() => first.result.current[1]('QB'));
    evict(first);
    renderHook(() => useAutoState('filter#0', 'ALL'), { wrapper });

    expect(getRestorationStats().restored).toBe(1);
    expect(getRestorationStats().restoredChanged).toBe(1);
    expect(getRestoredChangedSites()).toEqual([['filter#0:0', 1]]);
  });

  it('does not count a restore that lands on the initial value anyway', () => {
    const first = renderHook(() => useAutoState('filter#0', 'ALL'), { wrapper });
    evict(first);
    renderHook(() => useAutoState('filter#0', 'ALL'), { wrapper });

    expect(getRestorationStats().restored).toBe(1);
    expect(getRestorationStats().restoredChanged).toBe(0);
  });

  it('compares by value, so a rebuilt but equal selection is not a change', () => {
    const first = renderHook(() => useAutoState('filters#0', () => ({ positions: ['QB'] })), { wrapper });
    act(() => first.result.current[1]({ positions: ['QB'] }));
    evict(first);
    renderHook(() => useAutoState('filters#0', () => ({ positions: ['QB'] })), { wrapper });

    expect(getRestorationStats().restoredChanged).toBe(0);
  });

  it('judges a partly kept record by the fields it kept', () => {
    const makeInitial = () => ({ positionFilter: 'ALL', opacity: new Unholdable(1) });
    const first = renderHook(() => useAutoState('bundle#0', makeInitial), { wrapper });
    act(() => first.result.current[1]((prev) => ({ ...prev, positionFilter: 'WR' })));
    evict(first);
    renderHook(() => useAutoState('bundle#0', makeInitial), { wrapper });

    expect(getRestorationStats().restoredChanged).toBe(1);
  });
});

describe('restoration stats', () => {
  it('counts a refusal once per mount, however many times the component renders', () => {
    const rows = renderHook(() => [useAutoState('counted', 'a'), useAutoState('counted', 'a')] as const, { wrapper });

    // Contention is detected in an effect, so this is the first render that refuses, for both instances.
    act(() => rows.result.current[0][1]('changed'));
    const afterFirstRefusal = getRestorationStats().refusedContended;
    expect(afterFirstRefusal).toBe(2);

    act(() => rows.result.current[1][1]('changed again'));
    rows.rerender(undefined);
    rows.rerender(undefined);

    expect(getRestorationStats().refusedContended).toBe(afterFirstRefusal);
  });

  it('reports distinct keys alongside the count, so one noisy component cannot look like many', () => {
    const rows = renderHook(() => [useAutoState('one-key', 'a'), useAutoState('one-key', 'a')] as const, { wrapper });
    act(() => rows.result.current[0][1]('changed'));

    const stats = getRestorationStats();
    expect(stats.refusedContended).toBe(2);
    expect(stats.refusedContendedKeysDistinct).toBe(1);
  });

  it('counts an unanchored refusal per mount too', () => {
    const before = getRestorationStats().refusedUnanchored;
    const view = renderHook(() => useAutoState('outside', 'a'));
    const afterMount = getRestorationStats().refusedUnanchored;
    expect(afterMount).toBe(before + 1);

    view.rerender(undefined);
    view.rerender(undefined);
    expect(getRestorationStats().refusedUnanchored).toBe(afterMount);
  });
});

describe('sibling scenes', () => {
  function scene(name: string) {
    const Scene = ({ children }: { children: React.ReactNode }) => (
      <InTab>
        <RestorationNamespace name={name}>{children}</RestorationNamespace>
      </InTab>
    );
    Scene.displayName = `Scene(${name})`;
    return Scene;
  }

  it('does not let siblings see each other, and restores each on its own', () => {
    const trending = renderHook(() => useAutoState('positionFilter', 'ALL'), { wrapper: scene('trending') });
    const available = renderHook(() => useAutoState('positionFilter', 'ALL'), { wrapper: scene('available') });

    act(() => available.result.current[1]('QB'));
    expect(available.result.current[0]).toBe('QB');
    expect(trending.result.current[0]).toBe('ALL');

    evict(trending, available);

    expect(renderHook(() => useAutoState('positionFilter', 'ALL'), { wrapper: scene('available') }).result.current[0]).toBe('QB');
    expect(renderHook(() => useAutoState('positionFilter', 'ALL'), { wrapper: scene('trending') }).result.current[0]).toBe('ALL');
  });

  it('nests, so a namespaced scene inside another stays distinct', () => {
    const Outer = ({ children }: { children: React.ReactNode }) => (
      <InTab>
        <RestorationNamespace name="players">
          <RestorationNamespace name="available">{children}</RestorationNamespace>
        </RestorationNamespace>
      </InTab>
    );
    Outer.displayName = 'Scene(players>available)';

    const nested = renderHook(() => useAutoState('positionFilter', 'ALL'), { wrapper: Outer });
    act(() => nested.result.current[1]('WR'));
    evict(nested);

    expect(renderHook(() => useAutoState('positionFilter', 'ALL'), { wrapper: scene('available') }).result.current[0]).toBe('ALL');
    expect(renderHook(() => useAutoState('positionFilter', 'ALL'), { wrapper: Outer }).result.current[0]).toBe('WR');
  });
});
