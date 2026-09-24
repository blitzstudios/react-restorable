import React from 'react';
import { act, create } from 'react-test-renderer';
import { scrollOffsetsForTests, withScrollRestoration } from '../react-native/scroll_restoration';
import { markEvicted, resetRestorationForTests, setRestorationEnabled } from '../restorable_state';
import { useAutoState } from '../auto_restorable';
import { InTab } from './render';

const scrolled: { offset?: number; x?: number; y?: number }[] = [];
let lastProps: any = null;

const FakeList = React.forwardRef(function FakeList(props: any, ref: any) {
  lastProps = props;
  React.useImperativeHandle(ref, () => ({
    scrollToOffset: (options: { offset: number }) => scrolled.push({ offset: options.offset }),
    scrollTo: (options: { x?: number; y?: number }) => scrolled.push({ x: options.x, y: options.y }),
  }));
  return null;
});

const List = withScrollRestoration(FakeList as any, 'scrollToOffset');

const trees: any[] = [];

function render(element: React.ReactElement) {
  let tree: any;
  act(() => {
    tree = create(<InTab>{element}</InTab>);
  });
  trees.push(tree);
  return tree;
}

/** Unmounts the way an eviction does: the tab is marked before the list's cleanups run. */
function evict(tree: any) {
  act(() => {
    markEvicted('tab-1');
    tree.unmount();
  });
}

function scrollTo(y: number) {
  act(() => {
    lastProps.onScrollEndDrag({ nativeEvent: { contentOffset: { x: 0, y } } });
  });
}

beforeEach(() => {
  resetRestorationForTests();
  scrollOffsetsForTests().clear();
  scrolled.length = 0;
  lastProps = null;
});

// A tree left mounted still holds its key, so the next test's mount reads as contention and refuses.
afterEach(() => {
  act(() => trees.splice(0).forEach((tree) => tree.unmount()));
});

describe('withScrollRestoration', () => {
  it('re-applies the offset once the content is long enough to hold it', () => {
    const first = render(<List __restoreId="screen@0" />);
    scrollTo(800);
    evict(first);

    render(<List __restoreId="screen@0" />);
    act(() => lastProps.onContentSizeChange(0, 0));
    expect(scrolled).toEqual([]);

    act(() => lastProps.onContentSizeChange(0, 2000));
    expect(scrolled).toEqual([{ offset: 800 }]);
  });

  it('does not hand a virtualized list its offset at creation, which would leave it blank', () => {
    // `contentOffset` moves the scroll view without going through the list's own scroll state, so the render
    // window stays at the top and the viewport holds no cells until something scrolls. These restore through
    // `scrollToOffset` once content arrives instead — see the content-size test above.
    const first = render(<List __restoreId="screen@0" />);
    expect(lastProps.contentOffset).toBeUndefined();
    scrollTo(800);
    evict(first);

    render(<List __restoreId="screen@0" />);
    expect(lastProps.contentOffset).toBeUndefined();
  });

  it('does not re-send the creation offset once the user has scrolled away', () => {
    // On the scroll view, since it is the only kind given a creation offset at all.
    const ScrollViewLike = withScrollRestoration(FakeList as any, 'scrollTo');
    const first = render(<ScrollViewLike __restoreId="screen@0" />);
    scrollTo(800);
    evict(first);

    const second = render(<ScrollViewLike __restoreId="screen@0" />);
    const atCreation = lastProps.contentOffset;
    expect(atCreation).toEqual({ x: 0, y: 800 });
    act(() => lastProps.onScrollBeginDrag({ nativeEvent: { contentOffset: { x: 0, y: 800 } } }));
    act(() => second.update(<InTab><ScrollViewLike __restoreId="screen@0" /></InTab>));

    expect(lastProps.contentOffset).toBe(atCreation);
  });

  it('leaves a call site that sets its own creation offset alone', () => {
    const own = { x: 0, y: 10 };
    const first = render(<List __restoreId="screen@0" contentOffset={own} />);
    scrollTo(800);
    evict(first);

    render(<List __restoreId="screen@0" contentOffset={own} />);
    expect(lastProps.contentOffset).toBe(own);
  });

  describe('holding the first paint', () => {
    function restoringMount() {
      const first = render(<List __restoreId="screen@0" />);
      scrollTo(800);
      evict(first);
      return render(<List __restoreId="screen@0" />);
    }

    it('hides the content while the restore is still pending', () => {
      restoringMount();
      expect(lastProps.style).toEqual([undefined, { transform: [{ translateX: -100000 }], pointerEvents: 'none' }]);
    });

    // Opacity would hide it too, but an alpha below 1 stops any UIVisualEffectView in the list from
    // rendering, and it stays blank after the reveal.
    it('hides it without going translucent', () => {
      restoringMount();
      expect(lastProps.style).not.toEqual(expect.arrayContaining([expect.objectContaining({ opacity: expect.anything() })]));
    });

    it('reveals it as soon as the offset is applied', () => {
      restoringMount();
      act(() => lastProps.onContentSizeChange(0, 2000));
      expect(lastProps.style).toBeUndefined();
    });

    it('reveals it rather than holding a blank list indefinitely', () => {
      jest.useFakeTimers();
      try {
        restoringMount();
        expect(lastProps.style).not.toBeUndefined();
        act(() => jest.advanceTimersByTime(1000));
        expect(lastProps.style).toBeUndefined();
      } finally {
        jest.useRealTimers();
      }
    });

    it('reveals it when the user takes over', () => {
      restoringMount();
      act(() => lastProps.onScrollBeginDrag({ nativeEvent: { contentOffset: { x: 0, y: 0 } } }));
      expect(lastProps.style).toBeUndefined();
    });

    it('never holds a first mount, which has nothing to restore', () => {
      render(<List __restoreId="screen@0" />);
      expect(lastProps.style).toBeUndefined();
    });

    it('never holds a plain scroll view, already positioned at creation', () => {
      const ScrollViewLike = withScrollRestoration(FakeList as any, 'scrollTo');
      const first = render(<ScrollViewLike __restoreId="screen@1" />);
      scrollTo(800);
      evict(first);

      render(<ScrollViewLike __restoreId="screen@1" />);
      expect(lastProps.contentOffset).toEqual({ x: 0, y: 800 });
      expect(lastProps.style).toBeUndefined();
    });
  });

  it('starts at the top when remounted inside a live tab', () => {
    const first = render(<List __restoreId="screen@0" />);
    scrollTo(800);
    act(() => first.unmount());

    render(<List __restoreId="screen@0" />);
    act(() => lastProps.onContentSizeChange(0, 2000));
    expect(scrolled).toEqual([]);
    expect(scrollOffsetsForTests().size).toBe(0);
  });

  it('does not give every list at a shared call site the offset of whichever unmounted last', () => {
    const tree = render(
      <>
        <List __restoreId="screen@0" />
        <List __restoreId="screen@0" />
      </>,
    );
    scrollTo(800);
    evict(tree);

    render(<List __restoreId="screen@0" />);
    act(() => lastProps.onContentSizeChange(0, 2000));
    expect(scrolled).toEqual([]);
  });

  it('applies the offset only once', () => {
    const first = render(<List __restoreId="screen@0" />);
    scrollTo(500);
    evict(first);

    render(<List __restoreId="screen@0" />);
    act(() => lastProps.onContentSizeChange(0, 2000));
    act(() => lastProps.onContentSizeChange(0, 4000));
    expect(scrolled).toEqual([{ offset: 500 }]);
  });

  it('abandons the restore when the user takes over first', () => {
    const first = render(<List __restoreId="screen@0" />);
    scrollTo(800);
    evict(first);

    render(<List __restoreId="screen@0" />);
    act(() => lastProps.onScrollBeginDrag({ nativeEvent: { contentOffset: { x: 0, y: 0 } } }));
    act(() => lastProps.onContentSizeChange(0, 2000));
    expect(scrolled).toEqual([]);
  });

  it('does not restore across different call sites', () => {
    const first = render(<List __restoreId="screen@0" />);
    scrollTo(800);
    evict(first);

    render(<List __restoreId="screen@1" />);
    act(() => lastProps.onContentSizeChange(0, 2000));
    expect(scrolled).toEqual([]);
  });

  it('renders the list itself when tabs are not being evicted', () => {
    setRestorationEnabled(false);
    const onScrollEndDrag = jest.fn();
    const ref = React.createRef<any>();
    render(<List ref={ref} __restoreId="screen@0" onScrollEndDrag={onScrollEndDrag} />);

    expect(lastProps.onScrollEndDrag).toBe(onScrollEndDrag);
    expect(lastProps.__restoreId).toBeUndefined();
    expect(ref.current?.scrollToOffset).toBeInstanceOf(Function);
  });

  it('leaves a list the compiler gave no id completely untouched', () => {
    const onScrollEndDrag = jest.fn();
    render(<List onScrollEndDrag={onScrollEndDrag} />);

    expect(lastProps.onScrollEndDrag).toBe(onScrollEndDrag);
    expect(lastProps.onContentSizeChange).toBeUndefined();
    expect(scrollOffsetsForTests().size).toBe(0);
  });

  it('forgets a position at the very top, which is the same as having none', () => {
    const first = render(<List __restoreId="screen@0" />);
    scrollTo(800);
    scrollTo(0);
    evict(first);
    expect(scrollOffsetsForTests().size).toBe(0);
  });

  it('chains to the call site\'s own handlers', () => {
    const onScrollEndDrag = jest.fn();
    const onContentSizeChange = jest.fn();
    render(<List __restoreId="screen@0" onScrollEndDrag={onScrollEndDrag} onContentSizeChange={onContentSizeChange} />);

    scrollTo(300);
    act(() => lastProps.onContentSizeChange(10, 20));

    expect(onScrollEndDrag).toHaveBeenCalledTimes(1);
    expect(onContentSizeChange).toHaveBeenCalledWith(10, 20);
  });

  it('leaves a natively driven handler exactly as given', () => {
    const nativeHandler: any = jest.fn();
    nativeHandler.__isNative = true;
    render(<List __restoreId="screen@0" onScrollEndDrag={nativeHandler} />);

    expect(lastProps.onScrollEndDrag).toBe(nativeHandler);
  });

  it('tracks the horizontal axis for a horizontal list', () => {
    const first = render(<List __restoreId="screen@0" horizontal />);
    act(() => {
      lastProps.onScrollEndDrag({ nativeEvent: { contentOffset: { x: 250, y: 0 } } });
    });
    evict(first);

    render(<List __restoreId="screen@0" horizontal />);
    act(() => lastProps.onContentSizeChange(1000, 0));
    expect(scrolled).toEqual([{ offset: 250 }]);
  });
});

describe('per-row restoration namespaces', () => {
  // One `useState` call site, rendered once per row — which is every list in the app.
  const Row = ({ label }: { label: string }) => {
    const [value, setValue] = useAutoState('rowFilter', 'ALL');
    rowHandles[label] = { value, setValue };
    return null;
  };

  let rowHandles: Record<string, { value: string; setValue: (next: string) => void }> = {};

  const listProps = {
    __restoreId: 'screen@0',
    keyExtractor: (item: { id: string }) => item.id,
    renderItem: ({ item }: { item: { id: string } }) => <Row label={item.id} />,
  };

  beforeEach(() => {
    rowHandles = {};
    setRestorationEnabled(true);
  });

  afterEach(() => setRestorationEnabled(false));

  function renderRows(ids: string[]) {
    const tree = render(<List {...listProps} />);
    // The fake list does not virtualize, so drive `renderItem` the way a real one would.
    act(() => {
      tree.update(
        <InTab>
          <List {...listProps} />
          {ids.map((id) => (
            <RowHost key={id} id={id} />
          ))}
        </InTab>,
      );
    });
    return tree;
  }

  const RowHost = ({ id }: { id: string }) => lastProps.renderItem({ item: { id }, index: Number(id) });

  it('keeps each row\'s state to itself, where one shared key would have been refused as contended', () => {
    const tree = renderRows(['a', 'b']);
    act(() => rowHandles.a.setValue('QB'));

    expect(rowHandles.a.value).toBe('QB');
    expect(rowHandles.b.value).toBe('ALL');
    evict(tree);
    trees.length = 0;

    renderRows(['a', 'b']);
    expect(rowHandles.a.value).toBe('QB');
    expect(rowHandles.b.value).toBe('ALL');
  });

  it('leaves renderItem alone without a keyExtractor, since an index would restore into the wrong row', () => {
    render(<List __restoreId="screen@0" renderItem={listProps.renderItem} />);
    expect(lastProps.renderItem).toBe(listProps.renderItem);
  });

  it('leaves renderItem alone for a plain scroll view, which has no rows', () => {
    render(<List renderItem={listProps.renderItem} keyExtractor={listProps.keyExtractor} />);
    expect(lastProps.renderItem).toBe(listProps.renderItem);
  });
});
