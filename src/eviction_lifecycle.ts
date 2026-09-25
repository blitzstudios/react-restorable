import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { forgetRestorableState, markEvicted } from './restorable_state';
import {
  Snapshot,
  captureSnapshot,
  currentCaptureSequence,
  discardRestorationSnapshots,
  isSnapshotCaptureConfigured,
  peekSnapshot,
  subscribeToSnapshots,
} from './snapshots';

/** A capture that hangs must never keep a root resident, since releasing it is the point. */
const CAPTURE_DEADLINE_MS = 250;

/** How long the picture keeps covering after the tree returns, since mounted is not the same as painted. */
const HOLD_AFTER_RETURN_MS = 600;

export type EvictionLifecycleOptions = {
  /** Whether the root should be evicted. Its tree unmounts once `isEvicted` says so, which a snapshot can delay. */
  evict: boolean;
  /** How long an evicted root keeps what it left behind, its pictures included, before it is forgotten. */
  expireAfterMs: number;
  /** Off, nothing is marked, photographed or forgotten, and `isEvicted` follows `evict`. */
  enabled?: boolean;
  /** Keeps the root's state past the expiry while it returns true, such as for a tab parked mid-task. */
  shouldKeep?: () => boolean;
  /** Runs whenever the root expires, kept or not: for whatever else the host holds for it. */
  onExpire?: () => void;
  /**
   * Experimental. Photographs `viewRef` on the way out and hands the picture back as `snapshotUri` while the root
   * rebuilds. `place` is where in the root it was taken, so a root that moved on is not shown as somewhere it no
   * longer is. Inert until `configureRestorationSnapshots` is called.
   */
  snapshot?: { place: string; viewRef: { current: unknown } };
};

export type EvictionLifecycle = {
  /** Whether to unmount the root's tree now. */
  isEvicted: boolean;
  /** The picture to cover the root with, while it is evicted and for a moment after it returns. */
  snapshotUri: string | undefined;
};

/** Photographs the root on the way out, once per eviction, and reports the unmount as held until the picture lands. */
function useCaptureOnLeave(rootKey: string, place: string, viewRef: { current: unknown } | undefined, evict: boolean, enabled: boolean) {
  const [isCapturing, setCapturing] = useState(false);
  const wasEvictRef = useRef(evict);

  if (wasEvictRef.current !== evict) {
    wasEvictRef.current = evict;
    if (evict && enabled) setCapturing(true);
    else if (!evict) setCapturing(false);
  }

  useEffect(() => {
    if (!isCapturing) return undefined;

    let isCancelled = false;
    const finish = () => {
      if (!isCancelled) setCapturing(false);
    };

    const deadline = setTimeout(finish, CAPTURE_DEADLINE_MS);
    captureSnapshot(rootKey, place, viewRef?.current).finally(() => {
      clearTimeout(deadline);
      finish();
    });

    return () => {
      isCancelled = true;
      clearTimeout(deadline);
    };
  }, [isCapturing, rootKey, place, viewRef]);

  return isCapturing;
}

/**
 * Marks the root evicted as its tree unmounts, and forgets what it left once it has been away past `expireAfterMs`.
 * The expiry is checked while rendering the return as well as on a timer, since a JS timer does not run while the app
 * is backgrounded, and the returning tree reads what was kept from its state initializers in the same commit.
 */
function useMarkAndExpire(
  rootKey: string,
  isEvicted: boolean,
  { expireAfterMs, enabled, shouldKeep, onExpire }: Pick<EvictionLifecycleOptions, 'expireAfterMs' | 'shouldKeep' | 'onExpire'> & { enabled: boolean },
) {
  const evictedAtRef = useRef(0);
  const wasEvictedRef = useRef(isEvicted);

  // The latest callbacks, so the timer never calls one captured from an older render.
  const callbacksRef = useRef({ shouldKeep, onExpire });
  callbacksRef.current = { shouldKeep, onExpire };

  const expire = () => {
    discardRestorationSnapshots(rootKey);
    callbacksRef.current.onExpire?.();
    if (!callbacksRef.current.shouldKeep?.()) forgetRestorableState(rootKey);
  };

  if (enabled && wasEvictedRef.current !== isEvicted) {
    wasEvictedRef.current = isEvicted;
    if (isEvicted) {
      evictedAtRef.current = Date.now();
    } else if (evictedAtRef.current !== 0 && Date.now() - evictedAtRef.current >= expireAfterMs) {
      expire();
    }
  }

  // Layout phase, before the unmounted tree's passive cleanups, which is how they tell an eviction from a removal.
  useLayoutEffect(() => {
    if (enabled && isEvicted) markEvicted(rootKey);
  }, [enabled, isEvicted, rootKey]);

  useEffect(() => {
    if (!enabled || !isEvicted) return undefined;
    // `expire` reads the callbacks through the ref, and `rootKey` restarts the timer, so this closure never goes stale.
    const timer = setTimeout(expire, expireAfterMs);
    return () => clearTimeout(timer);
  }, [enabled, isEvicted, rootKey, expireAfterMs]);
}

/**
 * The picture to show: this eviction's, never an older one, resolved once so it cannot swap while on screen, and
 * held for a moment after the return. Keyed to `evict` rather than `isEvicted`, so it is already in place when the
 * switch begins and the capture it waits for has not landed yet.
 */
function useSnapshotToShow(rootKey: string, place: string, evict: boolean, enabled: boolean, maxAgeMs: number) {
  const [isHolding, setHolding] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | undefined>(undefined);
  const floorRef = useRef(currentCaptureSequence());
  const wasEvictRef = useRef(evict);

  if (wasEvictRef.current !== evict) {
    wasEvictRef.current = evict;
    setHolding(!evict);
    if (evict) {
      floorRef.current = currentCaptureSequence();
      setSnapshot(undefined);
    }
  }

  useEffect(() => {
    if (!enabled || !evict) return undefined;

    const read = () => {
      const fresh = peekSnapshot(rootKey, place, floorRef.current);
      if (fresh) setSnapshot((current) => current ?? fresh);
    };

    read();
    return subscribeToSnapshots(read);
  }, [enabled, evict, rootKey, place]);

  useEffect(() => {
    if (!isHolding || evict) return undefined;
    const timer = setTimeout(() => setHolding(false), HOLD_AFTER_RETURN_MS);
    return () => clearTimeout(timer);
  }, [isHolding, evict]);

  const isFresh = snapshot !== undefined && Date.now() - snapshot.capturedAt <= maxAgeMs;
  return enabled && isFresh && (evict || isHolding) ? snapshot.uri : undefined;
}

/**
 * The lifecycle of an evictable root: when its tree actually unmounts, the eviction mark its restorable state depends
 * on, when what it left is forgotten, and, optionally, the picture that covers its rebuild.
 */
export function useEvictionLifecycle(
  rootKey: string,
  { evict, expireAfterMs, enabled = true, shouldKeep, onExpire, snapshot }: EvictionLifecycleOptions,
): EvictionLifecycle {
  const isSnapshotEnabled = enabled && snapshot !== undefined && isSnapshotCaptureConfigured();
  const place = snapshot?.place ?? '';

  const isCapturing = useCaptureOnLeave(rootKey, place, snapshot?.viewRef, evict, isSnapshotEnabled);
  const isEvicted = evict && !isCapturing;

  useMarkAndExpire(rootKey, isEvicted, { expireAfterMs, enabled, shouldKeep, onExpire });
  const snapshotUri = useSnapshotToShow(rootKey, place, evict, isSnapshotEnabled, expireAfterMs);

  return { isEvicted, snapshotUri };
}
