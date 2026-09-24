import {
  hasRestorableStateForTests,
  pruneRestorableState,
  resetRestorationForTests,
  restorableStateSizeForTests,
  seedRestorableStateForTests,
} from '../restorable_state';

describe('pruneRestorableState', () => {
  beforeEach(resetRestorationForTests);

  it('keeps state whose anchor is still on its tab active path', () => {
    seedRestorableStateForTests('tab-fantasy|detail-1|Screen', 'sub_tab', 'players');
    pruneRestorableState({ 'tab-fantasy': ['tab-fantasy', 'detail-1', 'inner-1'] });
    expect(hasRestorableStateForTests('tab-fantasy|detail-1|Screen', 'sub_tab')).toBe(true);
  });

  it('keeps state for a screen buried under a push', () => {
    seedRestorableStateForTests('tab-fantasy|index-1|', 'scroll', 120);
    pruneRestorableState({ 'tab-fantasy': ['tab-fantasy', 'index-1', 'detail-1'] });
    expect(hasRestorableStateForTests('tab-fantasy|index-1|', 'scroll')).toBe(true);
  });

  it('discards state once its tab navigates elsewhere', () => {
    seedRestorableStateForTests('tab-fantasy|detail-1|Screen', 'sub_tab', 'players');
    pruneRestorableState({ 'tab-fantasy': ['tab-fantasy', 'index-1'] });
    expect(hasRestorableStateForTests('tab-fantasy|detail-1|Screen', 'sub_tab')).toBe(false);
  });

  it('keeps state for a tab whose nested state is not materialized', () => {
    // React Navigation leaves `route.state` undefined until a nested navigator diverges from its
    // initial state, so a tab at its stack root reports only itself.
    seedRestorableStateForTests('tab-scores|score-index-1|', 'sub_tab', 'mlb');
    pruneRestorableState({ 'tab-scores': ['tab-scores'] });
    expect(hasRestorableStateForTests('tab-scores|score-index-1|', 'sub_tab')).toBe(true);
  });

  it('discards state for a tab that is gone entirely', () => {
    seedRestorableStateForTests('tab-scores|score-index-1|', 'sub_tab', 'mlb');
    pruneRestorableState({ 'tab-fantasy': ['tab-fantasy', 'detail-1'] });
    expect(hasRestorableStateForTests('tab-scores|score-index-1|', 'sub_tab')).toBe(false);
  });

  it('prunes one tab without touching another', () => {
    seedRestorableStateForTests('tab-fantasy|detail-a|Screen', 'sub_tab', 'players');
    seedRestorableStateForTests('tab-scores|score-index-1|', 'sub_tab', 'mlb');
    pruneRestorableState({ 'tab-fantasy': ['tab-fantasy', 'index-1'], 'tab-scores': ['tab-scores'] });
    expect(hasRestorableStateForTests('tab-fantasy|detail-a|Screen', 'sub_tab')).toBe(false);
    expect(hasRestorableStateForTests('tab-scores|score-index-1|', 'sub_tab')).toBe(true);
  });

  it('never discards unanchored state, which no active path can vouch for', () => {
    seedRestorableStateForTests('unanchored|modal-1|', 'modal_filter', 'open');
    pruneRestorableState({});
    expect(hasRestorableStateForTests('unanchored|modal-1|', 'modal_filter')).toBe(true);
    expect(restorableStateSizeForTests()).toBe(1);
  });
});
