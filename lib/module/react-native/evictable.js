"use strict";

import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useEvictionLifecycle } from "../eviction_lifecycle.js";

/** How many gates read an `<Evictable>`, so one whose children stay mounted can tell when nothing unmounts. */
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
const EvictionContext = /*#__PURE__*/createContext({
  isEvicted: false,
  registry: null
});
/**
 * A root that can be evicted: its content unmounts while `evict` is on, and comes back as it was left. Owns when the
 * content actually unmounts, the eviction mark its restorable state depends on, the expiry, and the snapshot.
 */
export function Evictable({
  rootKey,
  unmountChildren = true,
  snapshot,
  style,
  children,
  ...options
}) {
  const contentRef = useRef(null);
  const {
    isEvicted,
    snapshotUri
  } = useEvictionLifecycle(rootKey, {
    ...options,
    snapshot: snapshot ? {
      place: snapshot.place,
      viewRef: contentRef
    } : undefined
  });
  const [registry] = useState(() => ({
    count: 0,
    hasWarned: false
  }));
  useEffect(() => {
    if (!__DEV__ || unmountChildren || !isEvicted || registry.count > 0 || registry.hasWarned) return;
    registry.hasWarned = true;
    // eslint-disable-next-line no-console
    console.warn(`[react-restorable] <Evictable rootKey="${rootKey}" unmountChildren={false}> was evicted with nothing inside reading ` + 'useIsEvicted(), so nothing unmounted. Render an <EvictionGate> around what should unmount.');
  }, [isEvicted, unmountChildren, rootKey, registry]);
  const value = useMemo(() => ({
    isEvicted,
    registry
  }), [isEvicted, registry]);
  return /*#__PURE__*/_jsxs(EvictionContext.Provider, {
    value: value,
    children: [/*#__PURE__*/_jsx(View, {
      ref: contentRef,
      style: style ?? styles.fill,
      collapsable: false,
      children: unmountChildren && isEvicted ? null : children
    }), !!snapshotUri && /*#__PURE__*/_jsx(View, {
      style: StyleSheet.absoluteFill,
      pointerEvents: "none",
      children: /*#__PURE__*/_jsx(Image, {
        source: {
          uri: snapshotUri
        },
        style: StyleSheet.absoluteFill,
        resizeMode: "cover"
      })
    })]
  });
}

/** Whether the nearest `<Evictable>` is evicted: what unmounts the content of one whose children stay mounted. */
export function useIsEvicted() {
  const {
    isEvicted,
    registry
  } = useContext(EvictionContext);
  useLayoutEffect(() => {
    if (!registry) return undefined;
    registry.count += 1;
    return () => {
      registry.count -= 1;
    };
  }, [registry]);
  return isEvicted;
}

/** Renders its children except while the nearest `<Evictable>` is evicted. */
export function EvictionGate({
  children
}) {
  return useIsEvicted() ? null : /*#__PURE__*/_jsx(_Fragment, {
    children: children
  });
}
const styles = StyleSheet.create({
  fill: {
    flex: 1
  }
});
//# sourceMappingURL=evictable.js.map