import React from 'react';
import { RestorableEntry } from '../restorable_state';
type Kind = 'scrollTo' | 'scrollToOffset';
/** Adds scroll restoration to a scrollable (`ScrollView`, `FlatList`, `FlashList`...), keyed by the `__restoreId` the babel plugin injects per JSX call site. */
export declare function withScrollRestoration<C extends React.ComponentType<any>>(WrappedComponent: C, kind: Kind): C;
export declare function scrollOffsetsForTests(): Map<string, RestorableEntry<{
    x: number;
    y: number;
}>>;
export {};
//# sourceMappingURL=scroll_restoration.d.ts.map