"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useEvictionLifecycle = useEvictionLifecycle;
var _react = require("react");
var _restorable_state = require("./restorable_state.js");
var _snapshots = require("./snapshots.js");
/** A capture that hangs must never keep a root resident, since releasing it is the point. */
const CAPTURE_DEADLINE_MS = 250;

/** How long the picture keeps covering after the tree returns, since mounted is not the same as painted. */
const HOLD_AFTER_RETURN_MS = 600;
/** Photographs the root on the way out, once per eviction, and reports the unmount as held until the picture lands. */
function useCaptureOnLeave(rootKey, place, viewRef, evict, enabled) {
  const [isCapturing, setCapturing] = (0, _react.useState)(false);
  const wasEvictRef = (0, _react.useRef)(evict);
  if (wasEvictRef.current !== evict) {
    wasEvictRef.current = evict;
    if (evict && enabled) setCapturing(true);else if (!evict) setCapturing(false);
  }
  (0, _react.useEffect)(() => {
    if (!isCapturing) return undefined;
    let isCancelled = false;
    const finish = () => {
      if (!isCancelled) setCapturing(false);
    };
    const deadline = setTimeout(finish, CAPTURE_DEADLINE_MS);
    (0, _snapshots.captureSnapshot)(rootKey, place, viewRef?.current).finally(() => {
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
  const evictedAtRef = (0, _react.useRef)(0);
  const wasEvictedRef = (0, _react.useRef)(isEvicted);

  // The latest callbacks, so the timer never calls one captured from an older render.
  const callbacksRef = (0, _react.useRef)({
    shouldKeep,
    onExpire
  });
  callbacksRef.current = {
    shouldKeep,
    onExpire
  };
  const expire = () => {
    (0, _snapshots.discardRestorationSnapshots)(rootKey);
    callbacksRef.current.onExpire?.();
    if (!callbacksRef.current.shouldKeep?.()) (0, _restorable_state.forgetRestorableState)(rootKey);
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
  (0, _react.useLayoutEffect)(() => {
    if (enabled && isEvicted) (0, _restorable_state.markEvicted)(rootKey);
  }, [enabled, isEvicted, rootKey]);
  (0, _react.useEffect)(() => {
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
  const [isHolding, setHolding] = (0, _react.useState)(false);
  const [snapshot, setSnapshot] = (0, _react.useState)(undefined);
  const floorRef = (0, _react.useRef)((0, _snapshots.currentCaptureSequence)());
  const wasEvictRef = (0, _react.useRef)(evict);
  if (wasEvictRef.current !== evict) {
    wasEvictRef.current = evict;
    setHolding(!evict);
    if (evict) {
      floorRef.current = (0, _snapshots.currentCaptureSequence)();
      setSnapshot(undefined);
    }
  }
  (0, _react.useEffect)(() => {
    if (!enabled || !evict) return undefined;
    const read = () => {
      const fresh = (0, _snapshots.peekSnapshot)(rootKey, place, floorRef.current);
      if (fresh) setSnapshot(current => current ?? fresh);
    };
    read();
    return (0, _snapshots.subscribeToSnapshots)(read);
  }, [enabled, evict, rootKey, place]);
  (0, _react.useEffect)(() => {
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
function useEvictionLifecycle(rootKey, {
  evict,
  expireAfterMs,
  enabled = true,
  shouldKeep,
  onExpire,
  snapshot
}) {
  const isSnapshotEnabled = enabled && snapshot !== undefined && (0, _snapshots.isSnapshotCaptureConfigured)();
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