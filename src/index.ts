export {
  UNANCHORED_SCOPE_PREFIX,
  configureRestorationScope,
  forgetRestorableState,
  getIsRestorationDebugEnabled,
  getIsRestorationEnabled,
  markEvicted,
  pruneRestorableState,
  RestorationHiddenBoundary,
  RestorationNamespace,
  setRestorationDebugEnabled,
  setRestorationEnabled,
  useRestorableState,
  useRestorationScope,
} from './restorable_state';
export type { RestorableEntry } from './restorable_state';
export { getRestorationStats, getRestoredChangedSites, isRestorable, useAutoState, useRestorationFrame } from './auto_restorable';
export type { RestorationFrameApi } from './auto_restorable';
