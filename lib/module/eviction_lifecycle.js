"use strict";

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { forgetRestorableState, markEvicted } from "./restorable_state.js";
import { captureSnapshot, currentCaptureSequence, discardRestorationSnapshots, isSnapshotCaptureConfigured, peekSnapshot, subscribeToSnapshots } from "./snapshots.js";

/** A capture that hangs must never keep a root resident, since releasing it is the point. */
const CAPTURE_DEADLINE_MS = 250;

/** How long the picture keeps covering after the tree returns, since mounted is not the same as painted. */
const HOLD_AFTER_RETURN_MS = 600;
/** Photographs the root on the way out, once per eviction, and reports the unmount as held until the picture lands. */
function useCaptureOnLeave(rootKey, place, viewRef, evict, enabled) {
  const [isCapturing, setCapturing] = useState(false);
  const wasEvictRef = useRef(evict);
  if (wasEvictRef.current !== evict) {
    wasEvictRef.current = evict;
    if (evict && enabled) setCapturing(true);else if (!evict) setCapturing(false);
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
function useMarkAndExpire(rootKey, isEvicted, {
  expireAfterMs,
  enabled,
  shouldKeep,
  onExpire
}) {
  const evictedAtRef = useRef(0);
  const wasEvictedRef = useRef(isEvicted);

  // The latest callbacks, so the timer never calls one captured from an older render.
  const callbacksRef = useRef({
    shouldKeep,
    onExpire
  });
  callbacksRef.current = {
    shouldKeep,
    onExpire
  };
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
function useSnapshotToShow(rootKey, place, evict, enabled, maxAgeMs) {
  const [isHolding, setHolding] = useState(false);
  const [snapshot, setSnapshot] = useState(undefined);
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
      if (fresh) setSnapshot(current => current ?? fresh);
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
export function useEvictionLifecycle(rootKey, {
  evict,
  expireAfterMs,
  enabled = true,
  shouldKeep,
  onExpire,
  snapshot
}) {
  const isSnapshotEnabled = enabled && snapshot !== undefined && isSnapshotCaptureConfigured();
  const place = snapshot?.place ?? '';
  const isCapturing = useCaptureOnLeave(rootKey, place, snapshot?.viewRef, evict, isSnapshotEnabled);
  const isEvicted = evict && !isCapturing;
  useMarkAndExpire(rootKey, isEvicted, {
    expireAfterMs,
    enabled,
    shouldKeep,
    onExpire
  });
  const snapshotUri = useSnapshotToShow(rootKey, place, evict, isSnapshotEnabled, expireAfterMs);
  return {
    isEvicted,
    snapshotUri
  };
}
//# sourceMappingURL=eviction_lifecycle.js.map