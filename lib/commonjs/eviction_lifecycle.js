"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useEvictionLifecycle = useEvictionLifecycle;
var _react = require("react");
var _restorable_state = require("./restorable_state.js");
/**
 * Marks a root evicted as its tree unmounts, and forgets what it left once it has been away past
 * `expireAfterMs`. The mark lands in the layout phase, before the unmounted tree's passive cleanups,
 * which is how those cleanups tell an eviction from a removal.
 *
 * The expiry is checked while rendering the root's return as well as on a timer, since a JS timer
 * does not run while the app is backgrounded, and the returning tree reads what was kept from its
 * state initializers in the same commit — so an effect would run too late.
 */
function useEvictionLifecycle(rootKey, {
  isEvicted,
  expireAfterMs,
  enabled = true,
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
//# sourceMappingURL=eviction_lifecycle.js.map