"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.collectLiveRouteKeys = collectLiveRouteKeys;
exports.computeRestorationScope = computeRestorationScope;
exports.useReactNavigationRestorationScope = useReactNavigationRestorationScope;
var _react = require("react");
var _core = require("@react-navigation/core");
var _restorable_state = require("../restorable_state.js");
/**
 * Scopes restoration to where a component sits in React Navigation. The root is the focused route of
 * the nearest tab navigator, which is what eviction unmounts, and the anchor is the route in that
 * tab's own stack, which survives eviction.
 *
 * The key cannot be a nested route key (eviction destroys nested navigators and React Navigation
 * reissues their keys) nor route names alone (two leagues share `LeaguesDetailScreen > Screen`), so it
 * is the anchor's key and identity params, then the names of the routes below it.
 */

function currentRoute(state) {
  const routes = state?.routes;
  if (!Array.isArray(routes) || routes.length === 0) return undefined;
  return routes[typeof state?.index === 'number' ? state.index : 0];
}
const NAVIGATION_PARAMS = new Set(['screen', 'params', 'state', 'initial']);
function isIdentityValue(value) {
  const type = typeof value;
  return value === null || type === 'string' || type === 'number' || type === 'boolean';
}

/**
 * What the anchor route is showing, as opposed to which route object it is: the stack router reuses
 * a route by name and merges params, so a second league lands on the same key. Primitives only.
 */
function identityOfRoute(route) {
  const params = route?.params;
  if (!params) return '';
  return Object.keys(params).sort().filter(name => !NAVIGATION_PARAMS.has(name) && isIdentityValue(params[name])).map(name => `${name}=${String(params[name])}`).join(',');
}

/** Builds `tabKey|anchorKey|identity|name>name`, outermost first, from each navigator's state with its index on this component's path. */
function computeRestorationScope(states) {
  const tabLevel = states.findIndex(s => s?.type === 'tab');
  if (tabLevel === -1) return `${_restorable_state.UNANCHORED_SCOPE_PREFIX}${currentRoute(states[0])?.key ?? 'none'}|`;
  const tabRoute = currentRoute(states[tabLevel]);
  const anchorLevel = Math.min(tabLevel + 1, states.length - 1);
  const anchor = currentRoute(states[anchorLevel]);
  const names = [];
  for (let i = anchorLevel + 1; i < states.length; i++) {
    const route = currentRoute(states[i]);
    if (route) names.push(route.name);
  }
  return `${tabRoute?.key ?? 'unanchored'}|${anchor?.key ?? 'none'}|${identityOfRoute(anchor)}|${names.join('>')}`;
}

/**
 * `state` with its index moved to the route this component renders under. The focused route is a
 * different screen whenever something is pushed on top, or the component mounts in a background tab.
 */
function onOwnPath(state, ownRouteKey, childStateKey) {
  const routes = state?.routes;
  if (!state || !Array.isArray(routes)) return state;
  const index = routes.findIndex(route => ownRouteKey !== undefined ? route.key === ownRouteKey : childStateKey !== undefined && route.state?.key === childStateKey);
  return index === -1 || index === state.index ? state : {
    ...state,
    index
  };
}
function collectStates(navigation, ownRouteKey) {
  const states = [];
  let current = navigation;
  let routeKey = ownRouteKey;
  let childStateKey;
  while (current) {
    let state;
    try {
      state = current.getState?.();
    } catch {
      state = undefined;
    }
    states.unshift(onOwnPath(state, routeKey, childStateKey));
    routeKey = undefined;
    childStateKey = state?.key;
    current = current.getParent?.();
  }
  return states;
}

/**
 * The scope hook to hand `configureRestorationScope`. Reads the contexts rather than `useNavigation()`,
 * which throws outside a navigator, and computes the scope once per screen rather than once per render.
 */
function useReactNavigationRestorationScope() {
  const navigation = (0, _react.useContext)(_core.NavigationContext);
  const routeKey = (0, _react.useContext)(_core.NavigationRouteContext)?.key;
  return (0, _react.useMemo)(() => computeRestorationScope(collectStates(navigation, routeKey)), [navigation, routeKey]);
}

/**
 * Every route key still reachable under each tab, the tab's own key first — what `pruneRestorableState`
 * takes. Every reachable route rather than the focused path: a screen pushed over another does not invalidate it.
 */
function collectLiveRouteKeys(tabState) {
  const live = {};
  const walk = (state, out) => {
    const navState = state;
    for (const route of navState?.routes ?? []) {
      out.push(route.key);
      walk(route.state, out);
    }
  };
  for (const route of tabState?.routes ?? []) {
    const keys = [route.key];
    walk(route.state, keys);
    live[route.key] = keys;
  }
  return live;
}
//# sourceMappingURL=scope.js.map