import React, { useState } from 'react';
import { act } from 'react-test-renderer';
import { useAutoState } from '../auto_restorable';
import { EvictionGate, Restorable, useIsEvicted } from '../react-native/restorable';
import { hasRestorableStateForTests, resetRestorationForTests, seedRestorableStateForTests } from '../restorable_state';
import { configureRestorationSnapshots, peekSnapshot, resetSnapshotCaptureForTests, seedSnapshotForTests } from '../snapshots';
import { InTab, Text, render, renderHook } from './render';

const mockAppStateListeners = new Set<(state: string) => void>();

// Plain host elements stand in for React Native's, which cannot load outside a React Native runtime.
jest.mock('react-native', () => ({
  View: 'View',
  Image: 'Image',
  StyleSheet: { absoluteFill: { position: 'absolute' }, create: <T,>(styles: T) => styles },
  AppState: {
    addEventListener: (_type: string, listener: (state: string) => void) => {
      mockAppStateListeners.add(listener);
      return { remove: () => mockAppStateListeners.delete(listener) };
    },
  },
}));

function setAppState(state: string) {
  act(() => mockAppStateListeners.forEach((listener) => listener(state)));
}

const EXPIRY_MS = 5 * 60 * 1000;

beforeEach(() => {
  resetRestorationForTests();
});

let setDraft: (draft: string) => void = () => undefined;
function Draft() {
  const [draft, set] = useAutoState('draft', 'fresh');
  setDraft = set;
  return <Text testID="draft">{draft}</Text>;
}

describe('<Restorable>', () => {
  const tree = (evict: boolean, props: Partial<React.ComponentProps<typeof Restorable>> = {}) => (
    <InTab>
      <Restorable rootKey="tab-1" evict={evict} expireAfterMs={EXPIRY_MS} {...props}>
        {props.children ?? <Draft />}
      </Restorable>
    </InTab>
  );

  it('unmounts its children while evicted and brings them back as they were left', () => {
    const view = render(tree(false));
    act(() => setDraft('typed'));

    view.rerender(tree(true));
    expect(view.queryByTestId('draft')).toBeUndefined();

    view.rerender(tree(false));
    expect(view.textOf('draft')).toBe('typed');
  });

  it('leaves the unmounting to a gate inside when its children stay mounted', () => {
    let setOuter: (value: string) => void = () => undefined;
    // Stands in for a navigator: state the restoration layer does not hold, which only survives by staying mounted.
    function Navigator({ children }: { children: React.ReactNode }) {
      const [outer, set] = useState('initial');
      setOuter = set;
      return (
        <>
          <Text testID="outer">{outer}</Text>
          {children}
        </>
      );
    }
    const gated = (evict: boolean) =>
      tree(evict, {
        unmountChildren: false,
        children: (
          <Navigator>
            <EvictionGate>
              <Draft />
            </EvictionGate>
          </Navigator>
        ),
      });

    const view = render(gated(false));
    act(() => setOuter('parked'));
    act(() => setDraft('typed'));

    view.rerender(gated(true));
    expect(view.textOf('outer')).toBe('parked');
    expect(view.queryByTestId('draft')).toBeUndefined();

    view.rerender(gated(false));
    expect(view.textOf('outer')).toBe('parked');
    expect(view.textOf('draft')).toBe('typed');
  });

  describe('the development check', () => {
    let warn: jest.SpyInstance;
    beforeEach(() => {
      warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => warn.mockRestore());

    it('warns when children that stay mounted have nothing inside to unmount them', () => {
      const view = render(tree(false, { unmountChildren: false }));
      view.rerender(tree(true, { unmountChildren: false }));
      expect(warn).toHaveBeenCalledTimes(__DEV__ ? 1 : 0);
    });

    it('says nothing when a gate is inside, or when it unmounts its own children', () => {
      const gated = (evict: boolean) =>
        tree(evict, {
          unmountChildren: false,
          children: (
            <EvictionGate>
              <Draft />
            </EvictionGate>
          ),
        });
      const view = render(gated(false));
      view.rerender(gated(true));

      const plain = render(tree(false));
      plain.rerender(tree(true));

      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('snapshot', () => {
    const capture = jest.fn<Promise<string>, [unknown]>();
    beforeEach(() => {
      capture.mockReset();
      capture.mockResolvedValue('file:///tmp/tab.jpg');
      configureRestorationSnapshots({ capture });
    });
    afterEach(() => resetSnapshotCaptureForTests());

    it('photographs the view holding its content, and covers the rebuild with the picture', async () => {
      const view = render(tree(false, { snapshot: { place: 'route-1' } }));
      view.rerender(tree(true, { snapshot: { place: 'route-1' } }));
      await act(async () => {
        await Promise.resolve();
      });

      expect(capture).toHaveBeenCalledWith({ hostType: 'View' });
      expect(view.findAllByType('Image').map((image) => image.props.source)).toEqual([{ uri: 'file:///tmp/tab.jpg' }]);
      expect(view.queryByTestId('draft')).toBeUndefined();
    });

    it('covers nothing without a snapshot', () => {
      const view = render(tree(false));
      view.rerender(tree(true));
      expect(view.findAllByType('Image')).toEqual([]);
      expect(capture).not.toHaveBeenCalled();
    });
  });
});

describe('expireOnBackground', () => {
  const SCOPE = 'tab-1|screen-1||';

  const root = (evict: boolean, props: Partial<React.ComponentProps<typeof Restorable>> = {}) => (
    <Restorable rootKey="tab-1" evict={evict} expireAfterMs={EXPIRY_MS} expireOnBackground {...props}>
      <Text testID="content">content</Text>
    </Restorable>
  );

  function seedBoth() {
    seedRestorableStateForTests(SCOPE, 'subtab', 'players');
    seedSnapshotForTests('tab-1', 'route-1', 'file:///tmp/tab.jpg');
  }

  it('forgets an evicted root, pictures included, as soon as the app backgrounds', () => {
    const view = render(root(false));
    view.rerender(root(true));
    seedBoth();

    setAppState('background');

    expect(hasRestorableStateForTests(SCOPE, 'subtab')).toBe(false);
    expect(peekSnapshot('tab-1', 'route-1')).toBeUndefined();
  });

  it('keeps the state of a root it is told to keep, and drops its pictures still', () => {
    const view = render(root(false, { shouldKeep: () => true }));
    view.rerender(root(true, { shouldKeep: () => true }));
    seedBoth();

    setAppState('background');

    expect(hasRestorableStateForTests(SCOPE, 'subtab')).toBe(true);
    expect(peekSnapshot('tab-1', 'route-1')).toBeUndefined();
  });

  it('keeps everything through a transient blur', () => {
    const view = render(root(false));
    view.rerender(root(true));
    seedBoth();

    setAppState('inactive');

    expect(hasRestorableStateForTests(SCOPE, 'subtab')).toBe(true);
    expect(peekSnapshot('tab-1', 'route-1')).toBeDefined();
  });

  it('leaves a root that is on screen alone', () => {
    render(root(false));
    seedBoth();

    setAppState('background');

    expect(hasRestorableStateForTests(SCOPE, 'subtab')).toBe(true);
  });

  it('does nothing unless asked, or while disabled', () => {
    const off = render(root(false, { expireOnBackground: false }));
    off.rerender(root(true, { expireOnBackground: false }));
    const disabled = render(root(false, { enabled: false }));
    disabled.rerender(root(true, { enabled: false }));
    seedBoth();

    setAppState('background');

    expect(hasRestorableStateForTests(SCOPE, 'subtab')).toBe(true);
    expect(peekSnapshot('tab-1', 'route-1')).toBeDefined();
  });

  it('stops listening once unmounted', () => {
    const view = render(root(false));
    expect(mockAppStateListeners.size).toBe(1);
    view.unmount();
    expect(mockAppStateListeners.size).toBe(0);
  });
});

describe('useIsEvicted', () => {
  it('is false outside any <Restorable>', () => {
    expect(renderHook(() => useIsEvicted()).result.current).toBe(false);
  });
});
