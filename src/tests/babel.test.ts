import { transformSync } from '@babel/core';
import plugin, { RestorableBabelOptions } from '../babel';

const ROOT = '/repo/clients/app-mobile';
const FILENAME = `${ROOT}/src/v2/fantasy_tab/components/example.tsx`;

/** The options the Sleeper app runs the transform with. */
const APP_OPTIONS: RestorableBabelOptions = {
  include: ['/app-mobile/src/'],
  helperHooks: { useMergeState: 'hook_helper' },
  scrollables: { root: 'AppScrollable' },
};

function transform(code: string, filename = FILENAME, options: RestorableBabelOptions = APP_OPTIONS) {
  return transformSync(code, {
    filename,
    root: ROOT,
    babelrc: false,
    configFile: false,
    presets: [['@babel/preset-typescript', { isTSX: true, allExtensions: true }]],
    plugins: [[plugin, options]],
  })!.code!;
}

describe('restorable transform', () => {
  it('rewrites react state only, leaving refs and effects alone', () => {
    const output = transform(`
      import { useState, useRef, useEffect } from 'react';
      export function Example({ leg }) {
        const [round, setRound] = useState(leg);
        const ref = useRef(false);
        useEffect(() => { setRound(leg); }, [leg]);
        return round;
      }
    `);

    expect(output).toContain('const _restore = useRestorationFrame("src/v2/fantasy_tab/components/example#0")');
    expect(output).toContain('_restore.state(0, useState(_restore.initial(0, leg)))');
    expect(output).toContain('import { useRestorationFrame } from "@sleeperhq/react-restorable"');
    expect(output).toContain('const ref = useRef(false)');
    expect(output).toContain('useEffect(() =>');
  });

  it('leaves a file that restores its own state entirely alone', () => {
    const output = transform(`
      import { useState } from 'react';
      import { useRestorableState } from '@sleeperhq/react-restorable';
      export function Example() {
        const [key] = useRestorableState('tabs', undefined);
        const [index] = useState(0);
        return [key, index];
      }
    `);

    expect(output).not.toContain('useRestorationFrame');
    expect(output).not.toContain('react-restorable"');
  });

  it('still rewrites a file that imports only the rest of the package', () => {
    const output = transform(`
      import { useState } from 'react';
      import { RestorationNamespace } from '@sleeperhq/react-restorable';
      export function Example() {
        const [index] = useState(0);
        return index;
      }
    `);

    expect(output).toContain('_restore.state(0, useState(_restore.initial(0, 0)))');
  });

  it('gives each function one frame, with a slot per call, and the same ids across runs', () => {
    const code = `
      import { useState } from 'react';
      export function Example() {
        const [a] = useState(1);
        const [b] = useState(2);
        return [a, b];
      }
    `;

    const output = transform(code);
    expect(transform(code)).toBe(output);
    expect(output.match(/useRestorationFrame\(/g)).toHaveLength(1);
    expect(output).toContain('_restore.state(0, useState(_restore.initial(0, 1)))');
    expect(output).toContain('_restore.state(1, useState(_restore.initial(1, 2)))');
  });

  it('honours the opt-out comment', () => {
    const output = transform(`
      import { useState } from 'react';
      export function Example() {
        // @no-restore
        const [a] = useState(1);
        const [b] = useState(2);
        return [a, b];
      }
    `);

    expect(output).toContain('const [a] = useState(1)');
    expect(output).toContain('_restore.state(0, useState(_restore.initial(0, 2)))');
  });

  it('leaves a local hook of the same name alone', () => {
    const output = transform(`
      function useState(x) { return x; }
      export function Example() {
        const a = useState(1);
        return a;
      }
    `);

    expect(output).not.toContain('useRestorationFrame');
  });

  it('rewrites useMergeState from the helper module', () => {
    const output = transform(`
      import { useMergeState } from 'src/hooks/hook_helper';
      export function Example() {
        const [state, setState] = useMergeState({ round: 1 });
        return state;
      }
    `);

    expect(output).toMatch(/_restore\.state\(0, useMergeState\(_restore\.initial\(0, \{\s*round: 1\s*\}\)\)\)/);
  });

  it('skips files outside the app source tree and test files', () => {
    const code = `
      import { useState } from 'react';
      export function Example() { return useState(1); }
    `;

    expect(transform(code, '/repo/clients/app-mobile/src/v2/example.test.tsx')).not.toContain('useRestorationFrame');
    expect(transform(code, '/repo/clients/node_modules/lib/index.js')).not.toContain('useRestorationFrame');
    expect(transform(code, '/repo/clients/app-shared/src/example.ts')).not.toContain('useRestorationFrame');
  });

  it('gives each AppScrollable call site its own id, and skips what only looks like one', () => {
    const output = transform(`
      import { AppScrollable } from 'src/components/ui/app_scrollable';
      export function Example() {
        return (
          <>
            <AppScrollable.ScrollView />
            <AppScrollable.FlatList />
            <AppScrollable.ReAnimated.FlashList />
            <AppScrollable.Animated.SectionList />
            <AppScrollable.RefreshControl />
          </>
        );
      }
    `);

    expect(output).toContain('__restoreId="src/v2/fantasy_tab/components/example@0"');
    expect(output).toContain('__restoreId="src/v2/fantasy_tab/components/example@1"');
    expect(output).toContain('__restoreId="src/v2/fantasy_tab/components/example@2"');
    expect(output).toContain('__restoreId="src/v2/fantasy_tab/components/example@3"');
    // Not a scrollable, so nothing to restore and no id.
    expect(output).not.toContain('@4');
  });

  it('gives an arrow with an expression body a block to hold its frame', () => {
    const output = transform(`
      import { useState } from 'react';
      export const useToggle = () => useState(false);
    `);

    expect(output).toMatch(/useToggle = \(\) => \{\s*const _restore = useHookRestorationFrame\("src\/v2\/fantasy_tab\/components\/example#0"\);\s*return _restore\.state\(0, useState\(_restore\.initial\(0, false\)\)\);/);
  });

  it('gives a custom hook a hook frame, however it is declared', () => {
    const output = transform(`
      import { useState } from 'react';
      export const useToggle = () => useState(false);
      export function useKeyboardHeight() { return useState(0); }
      const hooks = { useCounter() { return useState(1); }, useFlag: () => useState(true) };
    `);

    expect(output.match(/useHookRestorationFrame\(/g)).toHaveLength(4);
    expect(output).not.toContain('useRestorationFrame(');
  });

  it('gives a component a component frame, including one wrapped anonymously', () => {
    const output = transform(`
      import React, { useState } from 'react';
      export const Row = React.memo((props) => {
        const [expanded] = useState(false);
        return expanded;
      });
      export default function () { return useState(1); }
    `);

    expect(output.match(/useRestorationFrame\(/g)).toHaveLength(2);
    expect(output).not.toContain('useHookRestorationFrame');
  });

  it('marks each custom hook call a component makes, numbered by call site', () => {
    const output = transform(`
      import { useToggle } from 'src/hooks/use_toggle';
      export function Example() {
        const [a] = useToggle(false);
        const [b] = useToggle(true);
        return [a, b];
      }
    `);

    expect(output).toContain('(enterComponentHookCall("src/v2/fantasy_tab/components/example#0@0"), exitHookCall(useToggle(false)))');
    expect(output).toContain('(enterComponentHookCall("src/v2/fantasy_tab/components/example#0@1"), exitHookCall(useToggle(true)))');
    expect(output).toContain('import { enterComponentHookCall, exitHookCall } from "@sleeperhq/react-restorable"');
  });

  it('extends the chain from inside a hook, rather than starting it afresh', () => {
    const output = transform(`
      import { useToggle } from 'src/hooks/use_toggle';
      export function usePanel() { return useToggle(false); }
    `);

    expect(output).toContain('enterHookCall("src/v2/fantasy_tab/components/example#0@0")');
    expect(output).not.toContain('enterComponentHookCall');
  });

  it('shares one id between a function\'s frame and its call sites', () => {
    const output = transform(`
      import { useState } from 'react';
      import { useToggle } from 'src/hooks/use_toggle';
      export function Example() {
        const [open] = useToggle(false);
        const [count] = useState(0);
        return [open, count];
      }
    `);

    expect(output).toContain('useRestorationFrame("src/v2/fantasy_tab/components/example#0")');
    expect(output).toContain('enterComponentHookCall("src/v2/fantasy_tab/components/example#0@0")');
  });

  it('leaves React\'s and React Native\'s own hooks unmarked, and marks a hook reached through a namespace', () => {
    const output = transform(`
      import React, { useMemo, useEffect } from 'react';
      import { useWindowDimensions } from 'react-native';
      import { FeatureService } from 'src/services/feature';
      export function Example() {
        const size = useWindowDimensions();
        const memo = useMemo(() => 1, []);
        const ref = React.useRef(null);
        useEffect(() => {}, []);
        return FeatureService.Hooks.useIsFeatureEnabled('x');
      }
    `);

    expect(output.match(/enterComponentHookCall\(/g)).toHaveLength(1);
    expect(output).toContain('exitHookCall(FeatureService.Hooks.useIsFeatureEnabled(\'x\'))');
  });

  it('does not mark the frames it injects', () => {
    const output = transform(`
      import { useState } from 'react';
      export const useFlag = () => useState(true);
      export function Example() { return useState(1); }
    `);

    expect(output).not.toMatch(/exitHookCall\(use(Hook)?RestorationFrame/);
  });

  it('honours the opt-out on a custom hook call', () => {
    const output = transform(`
      import { useToggle } from 'src/hooks/use_toggle';
      export function Example() {
        // @no-restore
        return useToggle(false);
      }
    `);

    expect(output).not.toContain('enterComponentHookCall');
  });

  it('rewrites a helper hook at its call site without also marking it', () => {
    const output = transform(`
      import { useMergeState } from 'src/hooks/hook_helper';
      export function Example() { return useMergeState({ round: 1 }); }
    `);

    expect(output).toContain('_restore.state(0, useMergeState(');
    expect(output).not.toContain('enterComponentHookCall');
  });

  it('gives each function its own frame', () => {
    const output = transform(`
      import { useState } from 'react';
      export function First() { return useState(1); }
      export function Second() { return useState(2); }
    `);

    expect(output).toContain('useRestorationFrame("src/v2/fantasy_tab/components/example#0")');
    expect(output).toContain('useRestorationFrame("src/v2/fantasy_tab/components/example#1")');
  });

  it('leaves a call site that names itself alone', () => {
    const output = transform(`
      import { AppScrollable } from 'src/components/ui/app_scrollable';
      export function Example() {
        return <AppScrollable.FlatList __restoreId="chosen" />;
      }
    `);

    expect(output).toContain('"chosen"');
    expect(output).not.toContain('@0');
  });

  it('honours the opt-out on a scrollable', () => {
    const output = transform(`
      import { AppScrollable } from 'src/components/ui/app_scrollable';
      export function Example() {
        // @no-restore
        return <AppScrollable.FlatList />;
      }
    `);

    expect(output).not.toContain('__restoreId');
  });
});

describe('alongside the module and JSX transforms an app runs', () => {
  function transformLikeAnApp(code: string) {
    return transformSync(code, {
      filename: FILENAME,
      root: ROOT,
      babelrc: false,
      configFile: false,
      // In one pass with the transform, as React Native's preset runs them, so a call they rewrite is visited again.
      plugins: [
        [plugin, APP_OPTIONS],
        ['@babel/plugin-transform-typescript', { isTSX: true, allExtensions: true }],
        '@babel/plugin-transform-react-jsx',
        ['@babel/plugin-transform-modules-commonjs', { strict: false, strictMode: false, allowTopLevelThis: true }],
      ],
    })!.code!;
  }

  it('never leaves a runtime call the module transform did not see, as it would for a call it rewrote first', () => {
    const output = transformLikeAnApp(`
      import React, { useState } from 'react';
      import { useToggle } from 'src/hooks/use_toggle';
      import { AppScrollable } from 'src/components/ui/app_scrollable';
      export function Example() {
        const [open] = useToggle(false);
        const [count] = useState(0);
        React.useEffect(() => {}, [open]);
        return <AppScrollable.FlatList data={[count]} />;
      }
      export const useFlag = () => useState(true);
    `);

    expect(output).not.toMatch(/(^|[^.\w])(enterComponentHookCall|enterHookCall|exitHookCall|useRestorationFrame|useHookRestorationFrame)\(/);
    expect(output).toContain('_reactRestorable.enterComponentHookCall');
    expect(output).not.toMatch(/HookCall\)\([^)]*\), \(0, _reactRestorable\.exitHookCall\)\(_react\.default\.useEffect/);
    expect(output).toContain('__restoreId: "src/v2/fantasy_tab/components/example@0"');
  });

  it('does not mark React\'s own hook once the module transform has rewritten it to `_react.default.useEffect`', () => {
    const output = transformLikeAnApp(`
      import React from 'react';
      export const Snow = React.memo(function Snow() {
        React.useEffect(() => {}, []);
        return null;
      });
    `);

    expect(output).not.toContain('HookCall');
    expect(output).toContain('_react.default.useEffect(');
  });
});

describe('scrollables reached through an alias', () => {
  it('gives an id to a list aliased at module scope', () => {
    const code = transform(`
      import { AppScrollable } from 'src/components/ui/app_scrollable';
      const AnimatedFlashList = AppScrollable.ReAnimated.FlashList;
      export function ProfileAboutTab() {
        return <AnimatedFlashList data={[]} />;
      }
    `);
    expect(code).toMatch(/__restoreId="src\/v2\/fantasy_tab\/components\/example@0"/);
  });

  it('sees through the cast the alias is usually written with', () => {
    const code = transform(`
      import { AppScrollable } from 'src/components/ui/app_scrollable';
      const AnimatedFlashList = AppScrollable.ReAnimated.FlashList as unknown as typeof AppScrollable.FlashList;
      export function ProfileTrackingEntriesList() {
        return <AnimatedFlashList data={[]} />;
      }
    `);
    expect(code).toMatch(/__restoreId="src\/v2\/fantasy_tab\/components\/example@0"/);
  });

  it('gives an alias and a direct call site distinct ids', () => {
    const code = transform(`
      import { AppScrollable } from 'src/components/ui/app_scrollable';
      const AnimatedFlashList = AppScrollable.ReAnimated.FlashList;
      export function Screen() {
        return (
          <>
            <AnimatedFlashList data={[]} />
            <AppScrollable.ScrollView />
          </>
        );
      }
    `);
    expect(code).toMatch(/__restoreId="src\/v2\/fantasy_tab\/components\/example@0"/);
    expect(code).toMatch(/__restoreId="src\/v2\/fantasy_tab\/components\/example@1"/);
  });

  it('leaves an ordinary local component alone', () => {
    const code = transform(`
      const Header = () => null;
      export function Screen() {
        return <Header />;
      }
    `);
    expect(code).not.toMatch(/__restoreId/);
  });

  it('leaves an alias for something that is not a scrollable alone', () => {
    const code = transform(`
      import { AppScrollable } from 'src/components/ui/app_scrollable';
      const Refresh = AppScrollable.RefreshControl;
      export function Screen() {
        return <Refresh />;
      }
    `);
    expect(code).not.toMatch(/__restoreId/);
  });
});

describe('options', () => {
  const code = `
    import { useState } from 'react';
    export function Example() { return useState(1); }
  `;

  it('rewrites every file outside node_modules, from the package itself, when given none', () => {
    const output = transform(code, '/elsewhere/screens/example.tsx', {});
    expect(output).toContain('import { useRestorationFrame } from "@sleeperhq/react-restorable"');
    expect(output).toContain('useRestorationFrame("/elsewhere/screens/example#0")');
  });

  it('tags no scrollable when none are named', () => {
    const output = transform(
      `
        import { AppScrollable } from 'src/components/ui/app_scrollable';
        export function Example() { return <AppScrollable.FlatList />; }
      `,
      FILENAME,
      {},
    );
    expect(output).not.toContain('__restoreId');
  });

  it('leaves an excluded path alone', () => {
    expect(transform(code, FILENAME, { ...APP_OPTIONS, exclude: ['/fantasy_tab/'] })).not.toContain('useRestorationFrame');
  });

  it('imports the frame from wherever it is told to', () => {
    expect(transform(code, FILENAME, { ...APP_OPTIONS, runtimeModule: 'app/restoration' })).toContain('from "app/restoration"');
  });

  it('marks hooks from any other package, since a wasted mark costs less than a missed one', () => {
    const output = transform(`
      import { useNavigation } from '@react-navigation/native';
      import { useReactish } from 'react-ish';
      export function Example() {
        const navigation = useNavigation();
        return useReactish();
      }
    `);

    expect(output.match(/enterComponentHookCall\(/g)).toHaveLength(2);
  });

  it('leaves React hooks reached through a namespace import unmarked', () => {
    const output = transform(`
      import * as R from 'react';
      export function Example() { return R.useMemo(() => 1, []); }
    `);

    expect(output).not.toContain('enterComponentHookCall');
  });

  it('leaves a helper hook alone unless it is named', () => {
    const helper = `
      import { useMergeState } from 'src/hooks/hook_helper';
      export function Example() { return useMergeState({ round: 1 }); }
    `;
    expect(transform(helper, FILENAME, { include: ['/app-mobile/src/'] })).not.toContain('useRestorationFrame');
  });
});
