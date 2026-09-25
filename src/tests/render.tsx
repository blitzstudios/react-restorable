import React, { createContext, useContext } from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { configureRestorationScope } from '../restorable_state';

/** The scope a test mounts under. Unset, a component is unanchored, as it would be outside any navigator. */
export const TestScopeContext = createContext('unanchored|none|');

export const TAB_SCOPE = 'tab-1|screen-1||';

export function useTestScope() {
  return useContext(TestScopeContext);
}

configureRestorationScope(useTestScope);

export function InTab({ children }: { children: React.ReactNode }) {
  return <TestScopeContext.Provider value={TAB_SCOPE}>{children}</TestScopeContext.Provider>;
}

type Wrapper = (props: { children: React.ReactNode }) => React.ReactElement | null;

const mounted = new Set<ReactTestRenderer>();

/** Unmounts whatever a test left mounted, so its timers cannot keep the run alive or leak into the next test. */
afterEach(() => {
  act(() => mounted.forEach((root) => root.unmount()));
  mounted.clear();
});

function mount(element: React.ReactElement) {
  let root!: ReactTestRenderer;
  act(() => {
    root = create(element);
  });
  mounted.add(root);
  return root;
}

function unmountRoot(root: ReactTestRenderer) {
  if (!mounted.delete(root)) return;
  act(() => root.unmount());
}

export function renderHook<Result, Props = undefined>(
  hook: (props: Props) => Result,
  { wrapper: Wrap, initialProps }: { wrapper?: Wrapper; initialProps?: Props } = {},
) {
  const result = { current: undefined as unknown as Result };
  function Probe({ props }: { props: Props }) {
    result.current = hook(props);
    return null;
  }
  const element = (props: Props) => (Wrap ? <Wrap><Probe props={props} /></Wrap> : <Probe props={props} />);

  const root = mount(element(initialProps as Props));
  return {
    result,
    rerender: (props: Props) => act(() => root.update(element(props))),
    unmount: () => unmountRoot(root),
  };
}

export function render(element: React.ReactElement) {
  const root = mount(element);
  return {
    rerender: (next: React.ReactElement) => act(() => root.update(next)),
    unmount: () => unmountRoot(root),
    textOf: (testID: string) => root.root.findByProps({ testID }).props.children,
  };
}

/** A host element to read rendered text back from, the way a test reads `<Text testID>` in React Native. */
export function Text({ testID, children }: { testID: string; children: React.ReactNode }) {
  return React.createElement('text', { testID }, children);
}

/** Stands in for a class instance such as an `Animated.Value`, which restoration must never hold. */
export class Unholdable {
  constructor(public value: number) {}
}
