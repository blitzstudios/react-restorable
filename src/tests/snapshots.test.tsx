import { act } from 'react-test-renderer';
import { useEvictionLifecycle } from '../eviction_lifecycle';
import { resetRestorationForTests, seedRestorableStateForTests, hasRestorableStateForTests } from '../restorable_state';
import {
  captureSnapshot,
  configureRestorationSnapshots,
  currentCaptureSequence,
  discardRestorationSnapshots,
  peekSnapshot,
  resetSnapshotCaptureForTests,
} from '../snapshots';
import { renderHook } from './render';

const EXPIRY_MS = 5 * 60 * 1000;
const VIEW = { tag: 'view' };

const capture = jest.fn<Promise<string>, [unknown]>();
const release = jest.fn<void, [string]>();

beforeEach(() => {
  resetRestorationForTests();
  capture.mockReset();
  capture.mockResolvedValue('file:///tmp/tab.jpg');
  configureRestorationSnapshots({ capture, release });
  release.mockReset();
});

afterEach(() => resetSnapshotCaptureForTests());

/** A root with snapshots on, as a tab scene would use it. */
function scene({ place = 'route-1', rootKey = 'tab-fantasy', withSnapshot = true } = {}) {
  const viewRef = { current: VIEW as unknown };
  return renderHook(
    ({ evict, at }: { evict: boolean; at: string }) =>
      useEvictionLifecycle(rootKey, { evict, expireAfterMs: EXPIRY_MS, snapshot: withSnapshot ? { place: at, viewRef } : undefined }),
    { initialProps: { evict: false, at: place } },
  );
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('the store', () => {
  it('keeps the picture under the root and place it was taken at', async () => {
    await captureSnapshot('tab-fantasy', 'route-1', VIEW);
    expect(peekSnapshot('tab-fantasy', 'route-1')?.uri).toBe('file:///tmp/tab.jpg');
    expect(peekSnapshot('tab-fantasy', 'route-2')).toBeUndefined();
  });

  it('keeps nothing when the first capture fails, and the previous picture when a later one does', async () => {
    capture.mockRejectedValueOnce(new Error('view went away'));
    await captureSnapshot('tab-fantasy', 'route-1', VIEW);
    expect(peekSnapshot('tab-fantasy', 'route-1')).toBeUndefined();

    await captureSnapshot('tab-fantasy', 'route-1', VIEW);
    capture.mockRejectedValueOnce(new Error('view went away'));
    await captureSnapshot('tab-fantasy', 'route-1', VIEW);
    expect(peekSnapshot('tab-fantasy', 'route-1')?.uri).toBe('file:///tmp/tab.jpg');
  });

  it('does nothing without a view to photograph, or before capture is configured', async () => {
    await captureSnapshot('tab-fantasy', 'route-1', null);
    resetSnapshotCaptureForTests();
    await captureSnapshot('tab-fantasy', 'route-1', VIEW);
    expect(capture).not.toHaveBeenCalled();
  });

  it('refuses a picture taken before the moment asked about', async () => {
    const before = currentCaptureSequence();
    await captureSnapshot('tab-fantasy', 'route-1', VIEW);
    const after = currentCaptureSequence();

    expect(peekSnapshot('tab-fantasy', 'route-1', after)).toBeUndefined();
    expect(peekSnapshot('tab-fantasy', 'route-1', before)?.uri).toBe('file:///tmp/tab.jpg');
  });

  it('deletes the file of a picture that is replaced, discarded, or pushed past the bound', async () => {
    capture.mockResolvedValueOnce('file:///tmp/first.jpg').mockResolvedValueOnce('file:///tmp/second.jpg');
    await captureSnapshot('tab-fantasy', 'route-1', VIEW);
    await captureSnapshot('tab-fantasy', 'route-1', VIEW);
    expect(release.mock.calls).toEqual([['file:///tmp/first.jpg']]);

    discardRestorationSnapshots('tab-fantasy');
    expect(release.mock.calls).toEqual([['file:///tmp/first.jpg'], ['file:///tmp/second.jpg']]);

    release.mockReset();
    for (let index = 0; index <= 24; index += 1) {
      capture.mockResolvedValueOnce(`file:///tmp/${index}.jpg`);
      // Sequential on purpose: the bound evicts by capture order.
      // eslint-disable-next-line no-await-in-loop
      await captureSnapshot(`tab-${index}`, 'route-1', VIEW);
    }
    expect(release.mock.calls).toEqual([['file:///tmp/0.jpg']]);
  });

  it('discards one root without touching another', async () => {
    await captureSnapshot('tab-fantasy', 'route-1', VIEW);
    await captureSnapshot('tab-scores', 'route-1', VIEW);
    discardRestorationSnapshots('tab-fantasy');

    expect(peekSnapshot('tab-fantasy', 'route-1')).toBeUndefined();
    expect(peekSnapshot('tab-scores', 'route-1')).toBeDefined();
  });
});

describe('capture on the way out', () => {
  it('photographs the root as it leaves, and unmounts once the picture is taken', async () => {
    const view = scene();
    expect(capture).not.toHaveBeenCalled();

    view.rerender({ evict: true, at: 'route-1' });
    await settle();

    expect(capture).toHaveBeenCalledWith(VIEW);
    expect(peekSnapshot('tab-fantasy', 'route-1')?.uri).toBe('file:///tmp/tab.jpg');
    expect(view.result.current.isEvicted).toBe(true);
  });

  it('holds the unmount until the picture lands', async () => {
    let land: (uri: string) => void = () => undefined;
    capture.mockReturnValue(new Promise((resolve) => (land = resolve)));

    const view = scene();
    view.rerender({ evict: true, at: 'route-1' });
    expect(view.result.current.isEvicted).toBe(false);

    await act(async () => land('file:///tmp/tab.jpg'));
    expect(view.result.current.isEvicted).toBe(true);
  });

  it('gives up on a capture that hangs rather than keeping the root resident', () => {
    jest.useFakeTimers();
    try {
      capture.mockReturnValue(new Promise(() => undefined));
      const view = scene();
      view.rerender({ evict: true, at: 'route-1' });
      expect(view.result.current.isEvicted).toBe(false);

      act(() => jest.advanceTimersByTime(300));
      expect(view.result.current.isEvicted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('takes one picture per departure, and none for a root that stays', async () => {
    const view = scene();
    view.rerender({ evict: false, at: 'route-1' });
    expect(capture).not.toHaveBeenCalled();

    view.rerender({ evict: true, at: 'route-1' });
    await settle();
    view.rerender({ evict: false, at: 'route-1' });
    view.rerender({ evict: true, at: 'route-1' });
    await settle();

    expect(capture).toHaveBeenCalledTimes(2);
  });

  it('never delays an eviction without a snapshot, or before capture is configured', () => {
    const without = scene({ withSnapshot: false });
    without.rerender({ evict: true, at: 'route-1' });
    expect(without.result.current.isEvicted).toBe(true);

    resetSnapshotCaptureForTests();
    const unconfigured = scene();
    unconfigured.rerender({ evict: true, at: 'route-1' });
    expect(unconfigured.result.current.isEvicted).toBe(true);
    expect(capture).not.toHaveBeenCalled();
  });

  it('files the picture under the place the root was left at', async () => {
    const view = scene({ place: 'score-detail', rootKey: 'tab-scores' });
    view.rerender({ evict: true, at: 'score-detail' });
    await settle();

    expect(peekSnapshot('tab-scores', 'score-detail')).toBeDefined();
    expect(peekSnapshot('tab-scores', 'score-index')).toBeUndefined();
  });
});

describe('the picture shown', () => {
  it('covers the root while it is evicted, from the moment the picture lands', async () => {
    const view = scene();
    view.rerender({ evict: true, at: 'route-1' });
    expect(view.result.current.snapshotUri).toBeUndefined();

    await settle();
    expect(view.result.current.snapshotUri).toBe('file:///tmp/tab.jpg');
  });

  it('keeps covering for a moment after the root comes back, then lets go', async () => {
    const view = scene();
    view.rerender({ evict: true, at: 'route-1' });
    await settle();

    jest.useFakeTimers();
    try {
      view.rerender({ evict: false, at: 'route-1' });
      expect(view.result.current.snapshotUri).toBe('file:///tmp/tab.jpg');

      act(() => jest.advanceTimersByTime(1000));
      expect(view.result.current.snapshotUri).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('still covers a root left again faster than the hold', async () => {
    const view = scene();
    view.rerender({ evict: true, at: 'route-1' });
    await settle();
    view.rerender({ evict: false, at: 'route-1' });
    view.rerender({ evict: true, at: 'route-1' });
    await settle();

    expect(view.result.current.snapshotUri).toBe('file:///tmp/tab.jpg');
  });

  it('shows nothing for an eviction whose capture never landed, rather than an older picture', async () => {
    const view = scene();
    view.rerender({ evict: true, at: 'route-1' });
    await settle();
    view.rerender({ evict: false, at: 'route-1' });

    capture.mockRejectedValueOnce(new Error('view went away'));
    view.rerender({ evict: true, at: 'route-1' });
    await settle();

    expect(view.result.current.snapshotUri).toBeUndefined();
  });

  it('does not swap the picture partway through', async () => {
    const view = scene();
    view.rerender({ evict: true, at: 'route-1' });
    await settle();

    capture.mockResolvedValueOnce('file:///tmp/newer.jpg');
    await act(async () => {
      await captureSnapshot('tab-fantasy', 'route-1', VIEW);
    });
    view.rerender({ evict: false, at: 'route-1' });

    expect(view.result.current.snapshotUri).toBe('file:///tmp/tab.jpg');
  });

  it('shows nothing once the root has moved somewhere it has no picture of', async () => {
    await captureSnapshot('tab-scores', 'score-detail', VIEW);
    const view = scene({ place: 'score-index', rootKey: 'tab-scores' });
    capture.mockRejectedValue(new Error('no view'));
    view.rerender({ evict: true, at: 'score-index' });
    await settle();

    expect(view.result.current.snapshotUri).toBeUndefined();
  });

  it('refuses a picture of a root left long enough for its data to move on', async () => {
    const view = scene();
    view.rerender({ evict: true, at: 'route-1' });
    await settle();
    expect(view.result.current.snapshotUri).toBeDefined();

    const now = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + EXPIRY_MS + 60_000);
    try {
      view.rerender({ evict: false, at: 'route-1' });
      expect(view.result.current.snapshotUri).toBeUndefined();
    } finally {
      now.mockRestore();
    }
  });

  it('shows nothing without a snapshot option', async () => {
    await captureSnapshot('tab-fantasy', 'route-1', VIEW);
    const view = scene({ withSnapshot: false });
    view.rerender({ evict: true, at: 'route-1' });
    expect(view.result.current.snapshotUri).toBeUndefined();
  });
});

describe('expiry', () => {
  it('drops a root\u2019s pictures even while its state is kept', async () => {
    const SCOPE = 'tab-fantasy|detail-1|';
    seedRestorableStateForTests(SCOPE, 'subtab', 'players');
    const viewRef = { current: VIEW as unknown };
    const view = renderHook(
      ({ evict }: { evict: boolean }) =>
        useEvictionLifecycle('tab-fantasy', { evict, expireAfterMs: EXPIRY_MS, shouldKeep: () => true, snapshot: { place: 'route-1', viewRef } }),
      { initialProps: { evict: false } },
    );
    view.rerender({ evict: true });
    await settle();
    expect(peekSnapshot('tab-fantasy', 'route-1')).toBeDefined();

    const now = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + EXPIRY_MS + 1000);
    try {
      view.rerender({ evict: false });
    } finally {
      now.mockRestore();
    }

    expect(peekSnapshot('tab-fantasy', 'route-1')).toBeUndefined();
    expect(hasRestorableStateForTests(SCOPE, 'subtab')).toBe(true);
  });
});
