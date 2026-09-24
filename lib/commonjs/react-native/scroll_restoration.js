"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.scrollOffsetsForTests = scrollOffsetsForTests;
exports.withScrollRestoration = withScrollRestoration;
var _react = _interopRequireWildcard(require("react"));
var _restorable_state = require("../restorable_state.js");
var _auto_restorable = require("../auto_restorable.js");
var _jsxRuntime = require("react/jsx-runtime");
function _interopRequireWildcard(e, t) { if ("function" == typeof WeakMap) var r = new WeakMap(), n = new WeakMap(); return (_interopRequireWildcard = function (e, t) { if (!t && e && e.__esModule) return e; var o, i, f = { __proto__: null, default: e }; if (null === e || "object" != typeof e && "function" != typeof e) return f; if (o = t ? n : r) { if (o.has(e)) return o.get(e); o.set(e, f); } for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]); return f; })(e, t); }
/**
 * Scroll position across a tab eviction: captured from scroll events, re-applied on the way back.
 *
 * A virtualized list remounts with no rows and a content height of zero, where scrolling to an
 * offset does nothing, so the offset is held pending and re-applied as content arrives.
 */const offsetStore = new Map();
(0, _restorable_state.registerScopedStore)(offsetStore);
const RESTORE_WINDOW_MS = 10000;
const MIN_OFFSET = 4;
const HOLD_WINDOW_MS = 400;

// Hidden by position rather than opacity. An alpha below 1 makes UIKit composite the subtree in an
// offscreen pass, and any UIVisualEffectView inside the list then renders nothing and does not
// recover when the hold releases — so a restored list full of glass comes back flat.
const HELD_OFFSET = -100000;
const HELD_STYLE = {
  transform: [{
    translateX: HELD_OFFSET
  }],
  pointerEvents: 'none'
};
/** Whether a handler is attached natively by identity, in which case wrapping it demotes it to the JS thread. */
function isNativeHandler(handler) {
  if (typeof handler !== 'function' && typeof handler !== 'object') return false;
  if (handler === null) return false;
  const candidate = handler;
  return Boolean(candidate.__isNative || candidate.__workletHash || candidate.workletEventHandler);
}
function applyOffset(instance, kind, offset, horizontal) {
  if (!instance) return;
  if (kind === 'scrollTo') {
    instance.scrollTo?.({
      x: offset.x,
      y: offset.y,
      animated: false
    });
    return;
  }
  instance.scrollToOffset?.({
    offset: horizontal ? offset.x : offset.y,
    animated: false
  });
}
function readOffset(event) {
  const contentOffset = event?.nativeEvent?.contentOffset;
  if (!contentOffset) return undefined;
  return {
    x: contentOffset.x ?? 0,
    y: contentOffset.y ?? 0
  };
}

/**
 * Puts each row in its own restoration namespace, so the state inside it belongs to that row rather than to the
 * call site every row shares.
 *
 * The transform ids a `useState` by where it is written, which is one id for a component a list renders a hundred
 * times. Those instances collide on one key, the contention guard sees several live holders and refuses all of
 * them, and a list-heavy tab restores nothing. A row's key is the identity that survives the unmount, so it is what
 * the namespace is built from.
 *
 * Only when a `keyExtractor` says what a row is. Falling back to the index would key row 3 rather than the thing in
 * it, and after a sort or a filter the restore would land in the wrong row — worse than not restoring, and the
 * contention guard already handles not restoring safely.
 */
function useRowNamespace(renderItem, keyExtractor, restoreId, isActive) {
  return _react.default.useMemo(() => {
    if (!isActive || !renderItem || !keyExtractor || !restoreId) return undefined;
    const NamespacedRow = info => {
      const rendered = renderItem(info);
      if (rendered === null || rendered === undefined) return rendered;
      return /*#__PURE__*/(0, _jsxRuntime.jsx)(_restorable_state.RestorationNamespace, {
        name: `${restoreId}[${keyExtractor(info.item, info.index)}]`,
        children: rendered
      });
    };
    NamespacedRow.displayName = 'NamespacedRow';
    return NamespacedRow;
  }, [isActive, renderItem, keyExtractor, restoreId]);
}

/** Adds scroll restoration to a scrollable (`ScrollView`, `FlatList`, `FlashList`...), keyed by the `__restoreId` the babel plugin injects per JSX call site. */
function withScrollRestoration(WrappedComponent, kind) {
  const Restoring = /*#__PURE__*/_react.default.forwardRef(function ScrollRestoring({
    restoreId,
    ...props
  }, forwardedRef) {
    const offsetRef = (0, _react.useRef)(undefined);
    const onDetach = (0, _react.useCallback)((detachedKey, generation) => {
      const offset = offsetRef.current;
      if (offset && (Math.abs(offset.x) >= MIN_OFFSET || Math.abs(offset.y) >= MIN_OFFSET)) {
        (0, _restorable_state.writeRestorable)(offsetStore, detachedKey, offset, generation);
      } else {
        offsetStore.delete(detachedKey);
      }
    }, []);
    const key = (0, _auto_restorable.useScopedKey)(restoreId, offsetStore, true, onDetach);
    const instanceRef = (0, _react.useRef)(null);
    const pendingRef = (0, _react.useRef)(undefined);
    const deadlineRef = (0, _react.useRef)(0);
    const horizontal = Boolean(props.horizontal);

    // Read once per mount, before any scroll event can overwrite the stored value.
    const hasReadRef = (0, _react.useRef)(false);
    if (!hasReadRef.current) {
      hasReadRef.current = true;
      const stored = key === null ? undefined : (0, _restorable_state.readRestorable)(offsetStore, key)?.value;
      if (stored) {
        pendingRef.current = stored;
        offsetRef.current = stored;
        deadlineRef.current = Date.now() + RESTORE_WINDOW_MS;
      }
    }

    // Only the virtualized kinds have a frame to hide; a plain `ScrollView` is already positioned at creation by `contentOffset`.
    const [isHeld, setHeld] = (0, _react.useState)(() => kind === 'scrollToOffset' && pendingRef.current !== undefined);
    const release = (0, _react.useCallback)(() => setHeld(false), []);
    (0, _react.useEffect)(() => {
      if (!isHeld) return undefined;
      const timer = setTimeout(release, HOLD_WINDOW_MS);
      return () => clearTimeout(timer);
    }, [isHeld, release]);
    const setRef = (0, _react.useCallback)(instance => {
      instanceRef.current = instance;
      if (typeof forwardedRef === 'function') forwardedRef(instance);else if (forwardedRef) forwardedRef.current = instance;
    }, [forwardedRef]);
    const track = (0, _react.useCallback)(event => {
      const offset = readOffset(event);
      if (offset) offsetRef.current = offset;
    }, []);
    const originalScrollEndDrag = props.onScrollEndDrag;
    const onScrollEndDrag = (0, _react.useCallback)(event => {
      track(event);
      originalScrollEndDrag?.(event);
    }, [track, originalScrollEndDrag]);
    const originalMomentumEnd = props.onMomentumScrollEnd;
    const onMomentumScrollEnd = (0, _react.useCallback)(event => {
      track(event);
      originalMomentumEnd?.(event);
    }, [track, originalMomentumEnd]);
    const originalBeginDrag = props.onScrollBeginDrag;
    const onScrollBeginDrag = (0, _react.useCallback)(event => {
      pendingRef.current = undefined;
      release();
      originalBeginDrag?.(event);
    }, [originalBeginDrag, release]);
    const originalContentSizeChange = props.onContentSizeChange;
    const onContentSizeChange = (0, _react.useCallback)((width, height) => {
      const pending = pendingRef.current;
      if (pending) {
        if (Date.now() > deadlineRef.current) {
          pendingRef.current = undefined;
          release();
        } else {
          // Applying the offset against a half-filled list clamps it to the bottom of what has loaded.
          const extent = horizontal ? width : height;
          const target = horizontal ? pending.x : pending.y;
          if (extent > target) {
            pendingRef.current = undefined;
            applyOffset(instanceRef.current, kind, pending, horizontal);
            release();
          }
        }
      }
      originalContentSizeChange?.(width, height);
    }, [horizontal, originalContentSizeChange, release]);

    // The offset the native scroll view is created at, so nothing paints at the top first. Captured once
    // and kept by identity, since re-sending it after the user scrolls would drag them back to it.
    //
    // Plain scroll views only. A virtualized list computes its render window from its own scroll state, which
    // `contentOffset` does not go through: the view starts at the offset while the window is still at the top,
    // so the viewport holds no cells and the list reads as empty until a scroll event recomputes it. Those
    // restore through `scrollToOffset` once content arrives, which does update the window.
    const initialContentOffsetRef = (0, _react.useRef)(undefined);
    if (kind === 'scrollTo' && !initialContentOffsetRef.current && pendingRef.current && !props.contentOffset) {
      initialContentOffsetRef.current = pendingRef.current;
    }
    const rowNamespacedRenderItem = useRowNamespace(props.renderItem, props.keyExtractor, restoreId, key !== null);
    const overrides = {};
    if (rowNamespacedRenderItem) overrides.renderItem = rowNamespacedRenderItem;
    if (key !== null) {
      if (initialContentOffsetRef.current) overrides.contentOffset = initialContentOffsetRef.current;
      if (isHeld) overrides.style = [props.style, HELD_STYLE];
      if (!isNativeHandler(originalScrollEndDrag)) overrides.onScrollEndDrag = onScrollEndDrag;
      if (!isNativeHandler(originalMomentumEnd)) overrides.onMomentumScrollEnd = onMomentumScrollEnd;
      if (!isNativeHandler(originalBeginDrag)) overrides.onScrollBeginDrag = onScrollBeginDrag;
      if (!isNativeHandler(originalContentSizeChange)) overrides.onContentSizeChange = onContentSizeChange;
    }
    return /*#__PURE__*/(0, _jsxRuntime.jsx)(WrappedComponent, {
      ref: setRef,
      ...props,
      ...overrides
    });
  });

  // Eviction is fixed for the process and a call site's id never changes, so each list renders one branch for its life.
  const Enhanced = /*#__PURE__*/_react.default.forwardRef(function WithScrollRestoration({
    __restoreId: restoreId,
    ...props
  }, forwardedRef) {
    if (!restoreId || !(0, _restorable_state.getIsRestorationEnabled)()) return /*#__PURE__*/(0, _jsxRuntime.jsx)(WrappedComponent, {
      ref: forwardedRef,
      ...props
    });
    return /*#__PURE__*/(0, _jsxRuntime.jsx)(Restoring, {
      ref: forwardedRef,
      restoreId: restoreId,
      ...props
    });
  });
  return Enhanced;
}
function scrollOffsetsForTests() {
  return offsetStore;
}
//# sourceMappingURL=scroll_restoration.js.map