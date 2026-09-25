/**
 * Pictures of evicted roots, shown while they rebuild. Taken on the way out, because that is the frame the user
 * left, and filed under the root and the place in it they were taken at, so a root that moved on is not stood in
 * for by a picture of somewhere it no longer is.
 */
export type Snapshot = {
    uri: string;
    capturedAt: number;
    sequence: number;
};
export type SnapshotCapture = {
    /** Photographs a view and resolves to where the picture was written. Rejects when it cannot. */
    capture: (view: unknown) => Promise<string>;
    /** Deletes a picture `capture` wrote. Every picture is a file, so one dropped without this stays on disk. */
    release?: (uri: string) => void;
};
/** Set once, at launch. Unset, nothing is photographed and every snapshot option is inert. */
export declare function configureRestorationSnapshots(capture: SnapshotCapture): void;
export declare function isSnapshotCaptureConfigured(): boolean;
export declare function currentCaptureSequence(): number;
export declare function subscribeToSnapshots(listener: () => void): () => void;
export declare function captureSnapshot(rootKey: string, place: string, view: unknown): Promise<void>;
/** The picture filed under a place, if it was taken after `afterSequence`. */
export declare function peekSnapshot(rootKey: string, place: string, afterSequence?: number): Snapshot | undefined;
/** Drops every picture of a root, and deletes their files. */
export declare function discardRestorationSnapshots(rootKey: string): void;
/** Files a picture as if it had just been taken. */
export declare function seedSnapshotForTests(rootKey: string, place: string, uri: string): void;
export declare function resetSnapshotCaptureForTests(): void;
//# sourceMappingURL=snapshots.d.ts.map