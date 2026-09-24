import React from 'react';
import { act } from 'react-test-renderer';
import { reportRestorationStats, useAutoState } from '../auto_restorable';
import { useEvictionLifecycle } from '../eviction_lifecycle';
import {
  hasRestorableStateForTests,
  markEvicted,
  resetRestorationForTests,
  seedRestorableStateForTests,
  setRestorationDebugEnabled,
} from '../restorable_state';
import { InTab, Text, render, renderHook } from './render';

const EXPIRY_MS = 5 * 60 * 1000;

/** A scope as the React Navigation adapter builds them: the tab's route key, then the rest. */
const SCOPE = 'tab-fantasy|detail-1|leagueId=league-a';

beforeEach(() => {
  resetRestorationForTests();
});

function evict({ shouldKeep, onExpire = jest.fn(), enabled = true }: { shouldKeep?: () => boolean; onExpire?: jest.Mock; enabled?: boolean } = {}) {
  const view = renderHook(
    ({ isEvicted }: { isEvicted: boolean }) => useEvictionLifecycle('tab-fantasy', { isEvicted, expireAfterMs: EXPIRY_MS, enabled, shouldKeep, onExpire }),
    { initialProps: { isEvicted: false } },
  );
  return { ...view, onExpire };
}

describe('useEvictionLifecycle', () => {
  describe('marking', () => {
    let setDraft: (draft: string) => void = () => undefined;
    function Draft() {
      const [draft, set] = useAutoState('draft', 'fresh');
      setDraft = set;
      return <Text testID="draft">{draft}</Text>;
    }
    function Tab({ isEvicted }: { isEvicted: boolean }) {
      useEvictionLifecycle('tab-1', { isEvicted, expireAfterMs: EXPIRY_MS });
      return isEvicted ? null : <Draft />;
    }
    const tree = (isEvicted: boolean) => (
      <InTab>
        <Tab isEvicted={isEvicted} />
      </InTab>
    );

    it('marks the eviction before the unmounted tree cleans up, so its state comes back', () => {
      const view = render(tree(false));
      act(() => setDraft('typed'));
      view.rerender(tree(true));
      view.rerender(tree(false));

      expect(view.textOf('draft')).toBe('typed');
    });

    it('marks nothing for a tree that is removed rather than evicted', () => {
      const view = render(tree(false));
      act(() => setDraft('typed'));
      view.unmount();

      expect(render(tree(false)).textOf('draft')).toBe('fresh');
    });
  });

  it('keeps everything for a root that comes straight back', () => {
    seedRestorableStateForTests(SCOPE, 'subtab', 'players');

    const { rerender, onExpire } = evict();
    rerender({ isEvicted: true });
    rerender({ isEvicted: false });

    expect(hasRestorableStateForTests(SCOPE, 'subtab')).toBe(true);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('returns the memory while the root is still away, rather than waiting for a visit', () => {
    jest.useFakeTimers();
    try {
      seedRestorableStateForTests(SCOPE, 'subtab', 'players');
      const { rerender, onExpire } = evict();
      rerender({ isEvicted: true });

      act(() => jest.advanceTimersByTime(EXPIRY_MS + 1000));

      expect(hasRestorableStateForTests(SCOPE, 'subtab')).toBe(false);
      expect(onExpire).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('forgets on the way back in when the timer never got to run', () => {
    seedRestorableStateForTests(SCOPE, 'subtab', 'players');
    const { rerender, onExpire } = evict();
    const evictedAt = Date.now();
    rerender({ isEvicted: true });

    const now = jest.spyOn(Date, 'now').mockReturnValue(evictedAt + EXPIRY_MS + 1000);
    try {
      rerender({ isEvicted: false });
      expect(hasRestorableStateForTests(SCOPE, 'subtab')).toBe(false);
      expect(onExpire).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
    }
  });

  it('leaves another root alone', () => {
    const otherScope = 'tab-scores|index-1|';
    seedRestorableStateForTests(otherScope, 'subtab', 'nfl');

    jest.useFakeTimers();
    try {
      const { rerender } = evict();
      rerender({ isEvicted: true });
      act(() => jest.advanceTimersByTime(EXPIRY_MS + 1000));

      expect(hasRestorableStateForTests(otherScope, 'subtab')).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('starts the clock over on each eviction', () => {
    jest.useFakeTimers();
    try {
      seedRestorableStateForTests(SCOPE, 'subtab', 'players');
      const { rerender } = evict();

      // Four minutes away, back, then four more: neither stay earns an expiry on its own.
      rerender({ isEvicted: true });
      act(() => jest.advanceTimersByTime(EXPIRY_MS - 60_000));
      rerender({ isEvicted: false });
      rerender({ isEvicted: true });
      act(() => jest.advanceTimersByTime(EXPIRY_MS - 60_000));
      rerender({ isEvicted: false });

      expect(hasRestorableStateForTests(SCOPE, 'subtab')).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does nothing for a root that was never evicted', () => {
    seedRestorableStateForTests(SCOPE, 'subtab', 'players');
    jest.useFakeTimers();
    try {
      const { onExpire } = evict();
      act(() => jest.advanceTimersByTime(EXPIRY_MS * 2));

      expect(hasRestorableStateForTests(SCOPE, 'subtab')).toBe(true);
      expect(onExpire).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('marks and expires nothing when disabled', () => {
    jest.useFakeTimers();
    try {
      seedRestorableStateForTests(SCOPE, 'subtab', 'players');
      const { rerender, onExpire } = evict({ enabled: false });
      rerender({ isEvicted: true });
      act(() => jest.advanceTimersByTime(EXPIRY_MS + 1000));

      expect(hasRestorableStateForTests(SCOPE, 'subtab')).toBe(true);
      expect(onExpire).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps the state of a root it is told to keep, and still reports the expiry', () => {
    jest.useFakeTimers();
    try {
      seedRestorableStateForTests(SCOPE, 'subtab', 'players');
      const { rerender, onExpire } = evict({ shouldKeep: () => true });
      rerender({ isEvicted: true });
      act(() => jest.advanceTimersByTime(EXPIRY_MS + 1000));

      expect(hasRestorableStateForTests(SCOPE, 'subtab')).toBe(true);
      expect(onExpire).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('asks the latest callbacks, not the ones from when the root was evicted', () => {
    jest.useFakeTimers();
    try {
      seedRestorableStateForTests(SCOPE, 'subtab', 'players');
      let keep = true;
      const { rerender } = evict({ shouldKeep: () => keep });
      rerender({ isEvicted: true });
      keep = false;
      act(() => jest.advanceTimersByTime(EXPIRY_MS + 1000));

      expect(hasRestorableStateForTests(SCOPE, 'subtab')).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('reportRestorationStats', () => {
  let log: jest.SpyInstance;
  beforeEach(() => {
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    log.mockRestore();
    setRestorationDebugEnabled(false);
  });

  function restoreOnce() {
    const first = renderHook(() => useAutoState('filter#0', 'ALL'), { wrapper: InTab });
    act(() => first.result.current[1]('QB'));
    markEvicted('tab-1');
    first.unmount();
    renderHook(() => useAutoState('filter#0', 'ALL'), { wrapper: InTab });
  }

  it('says nothing unless debug reporting is on', () => {
    restoreOnce();
    reportRestorationStats();
    expect(log).not.toHaveBeenCalled();
  });

  it('says nothing before anything has happened', () => {
    setRestorationDebugEnabled(true);
    reportRestorationStats();
    expect(log).not.toHaveBeenCalled();
  });

  it('reports the counters and the call sites whose restores mattered', () => {
    restoreOnce();
    setRestorationDebugEnabled(true);
    log.mockClear();
    reportRestorationStats();

    expect(log.mock.calls[0][0]).toMatch(/^\[restore-stats\] restored=1 changed=1 changedSites=1 /);
    expect(log.mock.calls[1][0]).toBe('[restore-changed-sites] filter#0:0=1');
  });
});
