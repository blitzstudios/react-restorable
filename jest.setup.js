// React Native provides `__DEV__` as a global; Node does not, and source that guards on a bare `__DEV__` throws.
// Only a default: `jest.setup.prod.js` sets it false first.
if (typeof global.__DEV__ === 'undefined') global.__DEV__ = true;

// Tells React that `act` is in use, so updates outside it warn rather than pass silently.
global.IS_REACT_ACT_ENVIRONMENT = true;
