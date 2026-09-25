import React, { useState } from 'react';
import { act } from 'react-test-renderer';
import { useAutoState } from '../auto_restorable';
import { EvictionGate, Evictable, useIsEvicted } from '../react-native/evictable';
import { resetRestorationForTests } from '../restorable_state';
import { configureRestorationSnapshots, resetSnapshotCaptureForTests } from '../snapshots';
import { InTab, Text, render, renderHook } from './render';

// Plain host elements stand in for React Native's, which cannot load outside a React Native runtime.
jest.mock('react-native', () => ({
  View: 'View',
  Image: 'Image',
  StyleSheet: { absoluteFill: { position: 'absolute' }, create: <T,>(styles: T) => styles },
}));

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

describe('<Evictable>', () => {
  const tree = (evict: boolean, props: Partial<React.ComponentProps<typeof Evictable>> = {}) => (
    <InTab>
      <Evictable rootKey="tab-1" evict={evict} expireAfterMs={EXPIRY_MS} {...props}>
        {props.children ?? <Draft />}
      </Evictable>
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

describe('useIsEvicted', () => {
  it('is false outside any <Evictable>', () => {
    expect(renderHook(() => useIsEvicted()).result.current).toBe(false);
  });
});
