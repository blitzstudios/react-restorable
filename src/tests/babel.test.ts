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

    expect(output).toMatch(/useToggle = \(\) => \{\s*const _restore = useRestorationFrame\("src\/v2\/fantasy_tab\/components\/example#0"\);\s*return _restore\.state\(0, useState\(_restore\.initial\(0, false\)\)\);/);
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

  it('leaves a helper hook alone unless it is named', () => {
    const helper = `
      import { useMergeState } from 'src/hooks/hook_helper';
      export function Example() { return useMergeState({ round: 1 }); }
    `;
    expect(transform(helper, FILENAME, { include: ['/app-mobile/src/'] })).not.toContain('useRestorationFrame');
  });
});
