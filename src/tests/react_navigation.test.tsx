import React from 'react';
import { NavigationContext, NavigationRouteContext } from '@react-navigation/core';
import { act } from 'react-test-renderer';
import { useAutoState } from '../auto_restorable';
import { configureRestorationScope, markEvicted, resetRestorationForTests } from '../restorable_state';
import { collectLiveRouteKeys, computeRestorationScope, useReactNavigationRestorationScope } from '../react-navigation';
import { renderHook, useTestScope } from './render';

// The package ships ES modules only, and the adapter reads nothing from it but these two contexts.
jest.mock('@react-navigation/core', () => {
  const { createContext } = jest.requireActual<typeof import('react')>('react');
  return { NavigationContext: createContext(undefined), NavigationRouteContext: createContext(undefined) };
});

/** Root stack > bottom tabs > the tab's own stack > a navigator nested inside the screen. */
function chain({
  leagueRouteKey = 'detail-1',
  innerRouteKey = 'inner-1',
  innerName = 'Screen',
  params = undefined as Record<string, unknown> | undefined,
} = {}) {
  return [
    { type: 'stack', index: 0, routes: [{ key: 'root-1', name: 'MainBottomTabs' }] },
    { type: 'tab', index: 0, routes: [{ key: 'tab-fantasy', name: 'FantasyTab' }] },
    {
      type: 'stack',
      index: 1,
      routes: [
        { key: 'index-1', name: 'LeaguesIndexScreen' },
        { key: leagueRouteKey, name: 'LeaguesDetailScreen', params },
      ],
    },
    { type: 'stack', index: 0, routes: [{ key: innerRouteKey, name: innerName }] },
  ];
}

describe('computeRestorationScope', () => {
  it('anchors to the tab stack route and records the owning tab', () => {
    expect(computeRestorationScope(chain())).toBe('tab-fantasy|detail-1||Screen');
  });

  it('is stable when a nested navigator remounts with a fresh route key', () => {
    expect(computeRestorationScope(chain({ innerRouteKey: 'inner-2' }))).toBe(computeRestorationScope(chain({ innerRouteKey: 'inner-1' })));
  });

  it('separates two leagues that sit on identically named routes', () => {
    expect(computeRestorationScope(chain({ leagueRouteKey: 'detail-a' }))).not.toBe(computeRestorationScope(chain({ leagueRouteKey: 'detail-b' })));
  });

  it('distinguishes different screens below the same anchor', () => {
    expect(computeRestorationScope(chain({ innerName: 'Matchup' }))).not.toBe(computeRestorationScope(chain({ innerName: 'Roster' })));
  });

  it('separates two leagues the router handed the same route key', () => {
    const first = computeRestorationScope(chain({ params: { leagueId: 'league-a', sport: 'nfl' } }));
    const second = computeRestorationScope(chain({ params: { leagueId: 'league-b', sport: 'nfl' } }));
    expect(first).not.toBe(second);
  });

  it('is unmoved by navigating around inside the screen', () => {
    const parked = computeRestorationScope(chain({ params: { leagueId: 'league-a' } }));
    const deeper = computeRestorationScope(chain({ params: { leagueId: 'league-a', screen: 'Roster', params: { week: 3 } } }));
    expect(deeper).toBe(parked);
  });

  it('does not care what order the params were written in', () => {
    const one = computeRestorationScope(chain({ params: { leagueId: 'league-a', sport: 'nfl' } }));
    const other = computeRestorationScope(chain({ params: { sport: 'nfl', leagueId: 'league-a' } }));
    expect(one).toBe(other);
  });

  it('ignores a param that is not comparable across a navigate', () => {
    const withCallback = computeRestorationScope(chain({ params: { leagueId: 'league-a', onDone: () => undefined } }));
    expect(withCallback).toBe(computeRestorationScope(chain({ params: { leagueId: 'league-a' } })));
  });

  it('falls back to an unanchored scope outside a tab navigator', () => {
    expect(computeRestorationScope([{ type: 'stack', index: 0, routes: [{ key: 'modal-1', name: 'SomeModal' }] }])).toBe('unanchored|modal-1|');
  });

  it('tolerates a navigator with no state', () => {
    expect(() => computeRestorationScope([undefined, { type: 'tab', index: 0, routes: [] }])).not.toThrow();
  });
});


describe('useReactNavigationRestorationScope', () => {
  const tabNavigation = {
    getState: () => ({ type: 'tab', index: 0, routes: [{ key: 'tab-1', name: 'FantasyTab' }] }),
    getParent: () => undefined,
  };
  const stackNavigation = {
    getState: () => ({
      type: 'stack',
      index: 1,
      routes: [
        { key: 'league-a', name: 'LeaguesDetailScreen', params: { leagueId: 'a' } },
        { key: 'league-b', name: 'LeaguesDetailScreen', params: { leagueId: 'b' } },
      ],
    }),
    getParent: () => tabNavigation,
  };
  const onRoute = (routeKey: string) =>
    function OnRoute({ children }: { children: React.ReactNode }) {
      const route = stackNavigation.getState().routes.find((candidate) => candidate.key === routeKey);
      return (
        <NavigationContext.Provider value={stackNavigation as never}>
          <NavigationRouteContext.Provider value={route as never}>{children}</NavigationRouteContext.Provider>
        </NavigationContext.Provider>
      );
    };

  beforeEach(() => {
    resetRestorationForTests();
    configureRestorationScope(useReactNavigationRestorationScope);
  });
  afterEach(() => configureRestorationScope(useTestScope));

  it('keys a screen by its own route, not whichever route is pushed on top of it', () => {
    // League A's content mounts while league B is on top of it.
    const leagueA = renderHook(() => useAutoState('filter', 'ALL'), { wrapper: onRoute('league-a') });
    act(() => leagueA.result.current[1]('A-choice'));
    markEvicted('tab-1');
    leagueA.unmount();

    expect(renderHook(() => useAutoState('filter', 'ALL'), { wrapper: onRoute('league-b') }).result.current[0]).toBe('ALL');
    expect(renderHook(() => useAutoState('filter', 'ALL'), { wrapper: onRoute('league-a') }).result.current[0]).toBe('A-choice');
  });

  it('is unanchored outside a navigator', () => {
    expect(renderHook(() => useReactNavigationRestorationScope()).result.current).toBe('unanchored|none|');
  });
});

describe('collectLiveRouteKeys', () => {
  it('lists every route reachable under each tab, the tab first, including screens pushed over others', () => {
    const live = collectLiveRouteKeys({
      routes: [
        { key: 'tab-fantasy', state: { routes: [{ key: 'index-1' }, { key: 'detail-1', state: { routes: [{ key: 'inner-1' }] } }] } },
        { key: 'tab-scores' },
      ],
    });
    expect(live).toEqual({ 'tab-fantasy': ['tab-fantasy', 'index-1', 'detail-1', 'inner-1'], 'tab-scores': ['tab-scores'] });
  });
});
