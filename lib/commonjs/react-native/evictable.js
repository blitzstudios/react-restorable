"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Evictable = Evictable;
exports.EvictionGate = EvictionGate;
exports.useIsEvicted = useIsEvicted;
var _react = _interopRequireWildcard(require("react"));
var _reactNative = require("react-native");
var _eviction_lifecycle = require("../eviction_lifecycle.js");
var _jsxRuntime = require("react/jsx-runtime");
function _interopRequireWildcard(e, t) { if ("function" == typeof WeakMap) var r = new WeakMap(), n = new WeakMap(); return (_interopRequireWildcard = function (e, t) { if (!t && e && e.__esModule) return e; var o, i, f = { __proto__: null, default: e }; if (null === e || "object" != typeof e && "function" != typeof e) return f; if (o = t ? n : r) { if (o.has(e)) return o.get(e); o.set(e, f); } for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]); return f; })(e, t); }
/** How many gates read an `<Evictable>`, so one whose children stay mounted can tell when nothing unmounts. */

const EvictionContext = /*#__PURE__*/(0, _react.createContext)({
  isEvicted: false,
  registry: null
});
/**
 * A root that can be evicted: its content unmounts while `evict` is on, and comes back as it was left. Owns when the
 * content actually unmounts, the eviction mark its restorable state depends on, the expiry, and the snapshot.
 */
function Evictable({
  rootKey,
  unmountChildren = true,
  snapshot,
  style,
  children,
  ...options
}) {
  const contentRef = (0, _react.useRef)(null);
  const {
    isEvicted,
    snapshotUri
  } = (0, _eviction_lifecycle.useEvictionLifecycle)(rootKey, {
    ...options,
    snapshot: snapshot ? {
      place: snapshot.place,
      viewRef: contentRef
    } : undefined
  });
  const [registry] = (0, _react.useState)(() => ({
    count: 0,
    hasWarned: false
  }));
  (0, _react.useEffect)(() => {
    if (!__DEV__ || unmountChildren || !isEvicted || registry.count > 0 || registry.hasWarned) return;
    registry.hasWarned = true;
    // eslint-disable-next-line no-console
    console.warn(`[react-restorable] <Evictable rootKey="${rootKey}" unmountChildren={false}> was evicted with nothing inside reading ` + 'useIsEvicted(), so nothing unmounted. Render an <EvictionGate> around what should unmount.');
  }, [isEvicted, unmountChildren, rootKey, registry]);
  const value = (0, _react.useMemo)(() => ({
    isEvicted,
    registry
  }), [isEvicted, registry]);
  return /*#__PURE__*/(0, _jsxRuntime.jsxs)(EvictionContext.Provider, {
    value: value,
    children: [/*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.View, {
      ref: contentRef,
      style: style ?? styles.fill,
      collapsable: false,
      children: unmountChildren && isEvicted ? null : children
    }), !!snapshotUri && /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.View, {
      style: _reactNative.StyleSheet.absoluteFill,
      pointerEvents: "none",
      children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Image, {
        source: {
          uri: snapshotUri
        },
        style: _reactNative.StyleSheet.absoluteFill,
        resizeMode: "cover"
      })
    })]
  });
}

/** Whether the nearest `<Evictable>` is evicted: what unmounts the content of one whose children stay mounted. */
function useIsEvicted() {
  const {
    isEvicted,
    registry
  } = (0, _react.useContext)(EvictionContext);
  (0, _react.useLayoutEffect)(() => {
    if (!registry) return undefined;
    registry.count += 1;
    return () => {
      registry.count -= 1;
    };
  }, [registry]);
  return isEvicted;
}

/** Renders its children except while the nearest `<Evictable>` is evicted. */
function EvictionGate({
  children
}) {
  return useIsEvicted() ? null : /*#__PURE__*/(0, _jsxRuntime.jsx)(_jsxRuntime.Fragment, {
    children: children
  });
}
const styles = _reactNative.StyleSheet.create({
  fill: {
    flex: 1
  }
});
//# sourceMappingURL=evictable.js.map