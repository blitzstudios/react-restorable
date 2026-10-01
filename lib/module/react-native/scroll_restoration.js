"use strict";

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { RestorationNamespace, claimRestorable, getIsRestorationEnabled, registerScopedStore, writeRestorable } from "../restorable_state.js";
import { useScopedKey } from "../auto_restorable.js";

/**
 * Scroll position across a tab eviction: captured from scroll events, re-applied on the way back.
 *
 * A virtualized list remounts with no rows and a content height of zero, where scrolling to an
 * offset does nothing, so the offset is held pending and re-applied as content arrives.
 */
import { jsx as _jsx } from "react/jsx-runtime";
const offsetStore = new Map();
registerScopedStore(offsetStore);

/** How long a restore that has not landed yet may still move the list: a later jump would be under a user already reading it. */
const RESTORE_WINDOW_MS = 3000;

/** Rounding slack when comparing an offset with the furthest the content can scroll. */
const REACH_TOLERANCE = 1;
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
function readViewport(event, horizontal) {
  const layout = event?.nativeEvent?.layout;
  return (horizontal ? layout?.width : layout?.height) ?? 0;
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
  return React.useMemo(() => {
    if (!isActive || !renderItem || !keyExtractor || !restoreId) return undefined;
    const NamespacedRow = info => {
      const rendered = renderItem(info);
      if (rendered === null || rendered === undefined) return rendered;
      return /*#__PURE__*/_jsx(RestorationNamespace, {
        name: `${restoreId}[${keyExtractor(info.item, info.index)}]`,
        children: rendered
      });
    };
    NamespacedRow.displayName = 'NamespacedRow';
    return NamespacedRow;
  }, [isActive, renderItem, keyExtractor, restoreId]);
}

/** Adds scroll restoration to a scrollable (`ScrollView`, `FlatList`, `FlashList`...), keyed by the `__restoreId` the babel plugin injects per JSX call site. */
export function withScrollRestoration(WrappedComponent, kind) {
  const Restoring = /*#__PURE__*/React.forwardRef(function ScrollRestoring({
    restoreId,
    ...props
  }, forwardedRef) {
    const offsetRef = useRef(undefined);
    const pendingRef = useRef(undefined);
    const onDetach = useCallback((detachedKey, generation) => {
      // A restore that never landed is still where the user left the list.
      const offset = pendingRef.current ?? offsetRef.current;
      if (offset && (Math.abs(offset.x) >= MIN_OFFSET || Math.abs(offset.y) >= MIN_OFFSET)) {
        writeRestorable(offsetStore, detachedKey, offset, generation);
      } else {
        offsetStore.delete(detachedKey);
      }
    }, []);
    const key = useScopedKey(restoreId, offsetStore, true, onDetach);
    const claimant = useId();
    const instanceRef = useRef(null);
    const deadlineRef = useRef(0);
    const viewportRef = useRef(0);
    const extentRef = useRef(0);
    const horizontal = Boolean(props.horizontal);

    // Read once per mount, before any scroll event can overwrite the stored value.
    const hasReadRef = useRef(false);
    if (!hasReadRef.current) {
      hasReadRef.current = true;
      const stored = key === null ? undefined : claimRestorable(offsetStore, key, claimant)?.value;
      if (stored) {
        pendingRef.current = stored;
        offsetRef.current = stored;
        deadlineRef.current = Date.now() + RESTORE_WINDOW_MS;
      }
    }

    // Only the virtualized kinds have a frame to hide; a plain `ScrollView` is already positioned at creation by `contentOffset`.
    const [isHeld, setHeld] = useState(() => kind === 'scrollToOffset' && pendingRef.current !== undefined);
    const release = useCallback(() => setHeld(false), []);

    // Revealed at the end of the hold either way. Content already past the offset gets it now, clamped to what has
    // loaded, while the list is still hidden; a jump after the reveal would be under a user already reading it.
    useEffect(() => {
      if (!isHeld) return undefined;
      const timer = setTimeout(() => {
        const pending = pendingRef.current;
        if (pending && extentRef.current > (horizontal ? pending.x : pending.y)) {
          pendingRef.current = undefined;
          applyOffset(instanceRef.current, kind, pending, horizontal);
        }
        release();
      }, HOLD_WINDOW_MS);
      return () => clearTimeout(timer);
    }, [isHeld, release, horizontal]);
    const setRef = useCallback(instance => {
      instanceRef.current = instance;
      if (typeof forwardedRef === 'function') forwardedRef(instance);else if (forwardedRef) forwardedRef.current = instance;
    }, [forwardedRef]);
    const track = useCallback(event => {
      // Until the restore lands, scroll events are the list settling at the top, not the user moving it.
      if (pendingRef.current) return;
      const offset = readOffset(event);
      if (offset) offsetRef.current = offset;
    }, []);

    // Catches what the drag and momentum events miss, such as a `scrollToOffset` the screen makes without animating.
    const originalScroll = props.onScroll;
    const onScroll = useCallback(event => {
      track(event);
      originalScroll?.(event);
    }, [track, originalScroll]);
    const originalLayout = props.onLayout;
    const onLayout = useCallback(event => {
      viewportRef.current = readViewport(event, horizontal);
      originalLayout?.(event);
    }, [horizontal, originalLayout]);
    const originalScrollEndDrag = props.onScrollEndDrag;
    const onScrollEndDrag = useCallback(event => {
      track(event);
      originalScrollEndDrag?.(event);
    }, [track, originalScrollEndDrag]);
    const originalMomentumEnd = props.onMomentumScrollEnd;
    const onMomentumScrollEnd = useCallback(event => {
      track(event);
      originalMomentumEnd?.(event);
    }, [track, originalMomentumEnd]);
    const originalBeginDrag = props.onScrollBeginDrag;
    const onScrollBeginDrag = useCallback(event => {
      pendingRef.current = undefined;
      release();
      originalBeginDrag?.(event);
    }, [originalBeginDrag, release]);
    const originalContentSizeChange = props.onContentSizeChange;
    const onContentSizeChange = useCallback((width, height) => {
      const extent = horizontal ? width : height;
      extentRef.current = extent;
      const pending = pendingRef.current;
      if (pending) {
        if (Date.now() > deadlineRef.current) {
          pendingRef.current = undefined;
          release();
        } else {
          // Applying the offset against a half-filled list clamps it to the bottom of what has loaded. The furthest a
          // list scrolls is its content less its viewport; until a layout says how tall that is, content past the
          // offset is the best available sign.
          const target = horizontal ? pending.x : pending.y;
          const viewport = viewportRef.current;
          const isReachable = viewport > 0 ? extent - viewport + REACH_TOLERANCE >= target : extent > target;
          if (isReachable) {
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
    const initialContentOffsetRef = useRef(undefined);
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
      if (!isNativeHandler(originalLayout)) overrides.onLayout = onLayout;
      // A virtualized list listens to its scroll events anyway, to window its rows. A plain scroll view only sends them
      // when something is listening, so it is only tracked through a handler the call site already gives it.
      if (!isNativeHandler(originalScroll) && (kind === 'scrollToOffset' || typeof originalScroll === 'function')) overrides.onScroll = onScroll;
    }
    return /*#__PURE__*/_jsx(WrappedComponent, {
      ref: setRef,
      ...props,
      ...overrides
    });
  });

  // Eviction is fixed for the process and a call site's id never changes, so each list renders one branch for its life.
  const Enhanced = /*#__PURE__*/React.forwardRef(function WithScrollRestoration({
    __restoreId: restoreId,
    ...props
  }, forwardedRef) {
    if (!restoreId || !getIsRestorationEnabled()) return /*#__PURE__*/_jsx(WrappedComponent, {
      ref: forwardedRef,
      ...props
    });
    return /*#__PURE__*/_jsx(Restoring, {
      ref: forwardedRef,
      restoreId: restoreId,
      ...props
    });
  });
  return Enhanced;
}
export function scrollOffsetsForTests() {
  return offsetStore;
}
//# sourceMappingURL=scroll_restoration.js.map