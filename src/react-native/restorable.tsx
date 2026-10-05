import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState, Image, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { EvictionLifecycleOptions, useEvictionLifecycle } from '../eviction_lifecycle';

/** How many gates read an `<Restorable>`, so one whose children stay mounted can tell when nothing unmounts. */
type GateRegistry = { count: number; hasWarned: boolean };

const EvictionContext = createContext<{ isEvicted: boolean; registry: GateRegistry | null }>({ isEvicted: false, registry: null });

export type RestorableProps = Omit<EvictionLifecycleOptions, 'snapshot'> & {
  rootKey: string;
  /**
   * Off, the children stay mounted through an eviction and something inside unmounts instead, by reading
   * `useIsEvicted()` or rendering an `<EvictionGate>` — for a navigator whose state would go with it, say.
   */
  unmountChildren?: boolean;
  /** Experimental. Photographs the content on the way out and covers its rebuild with the picture. */
  snapshot?: { place: string };
  /**
   * Expires the root as soon as the app goes to the background while it is evicted, rather than waiting out
   * `expireAfterMs`: backgrounding is when the OS wants memory back. `inactive` does not count, so a transient
   * blur — the app switcher, a permission sheet — keeps what the root left.
   */
  expireOnBackground?: boolean;
  /** The style of the view that holds the children, which is the view photographed. Fills the parent by default. */
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
};

/**
 * A root that can be evicted: its content unmounts while `evict` is on, and comes back as it was left. Owns when the
 * content actually unmounts, the eviction mark its restorable state depends on, the expiry, and the snapshot.
 */
export function Restorable({ rootKey, unmountChildren = true, snapshot, expireOnBackground = false, style, children, ...options }: RestorableProps) {
  const contentRef = useRef<View | null>(null);
  const { isEvicted, snapshotUri, expire } = useEvictionLifecycle(rootKey, {
    ...options,
    snapshot: snapshot ? { place: snapshot.place, viewRef: contentRef } : undefined,
  });

  useEffect(() => {
    if (!expireOnBackground) return undefined;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') expire();
    });
    return () => subscription.remove();
  }, [expireOnBackground, expire]);

  const [registry] = useState<GateRegistry>(() => ({ count: 0, hasWarned: false }));
  useEffect(() => {
    if (!__DEV__ || unmountChildren || !isEvicted || registry.count > 0 || registry.hasWarned) return;
    registry.hasWarned = true;
    // eslint-disable-next-line no-console
    console.warn(
      `[react-restorable] <Restorable rootKey="${rootKey}" unmountChildren={false}> was evicted with nothing inside reading ` +
        'useIsEvicted(), so nothing unmounted. Render an <EvictionGate> around what should unmount.',
    );
  }, [isEvicted, unmountChildren, rootKey, registry]);

  const value = useMemo(() => ({ isEvicted, registry }), [isEvicted, registry]);

  return (
    <EvictionContext.Provider value={value}>
      <View ref={contentRef} style={style ?? styles.fill} collapsable={false}>
        {unmountChildren && isEvicted ? null : children}
      </View>
      {/* In place while the root is still away: a switch back that starts on the UI thread would beat a newly mounted image. */}
      {!!snapshotUri && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Image source={{ uri: snapshotUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        </View>
      )}
    </EvictionContext.Provider>
  );
}

/** Whether the nearest `<Restorable>` is evicted: what unmounts the content of one whose children stay mounted. */
export function useIsEvicted() {
  const { isEvicted, registry } = useContext(EvictionContext);
  useLayoutEffect(() => {
    if (!registry) return undefined;
    registry.count += 1;
    return () => {
      registry.count -= 1;
    };
  }, [registry]);
  return isEvicted;
}

/** Renders its children except while the nearest `<Restorable>` is evicted. */
export function EvictionGate({ children }: { children: React.ReactNode }) {
  return useIsEvicted() ? null : <>{children}</>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
