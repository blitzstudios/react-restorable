"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.captureSnapshot = captureSnapshot;
exports.configureRestorationSnapshots = configureRestorationSnapshots;
exports.currentCaptureSequence = currentCaptureSequence;
exports.discardRestorationSnapshots = discardRestorationSnapshots;
exports.isSnapshotCaptureConfigured = isSnapshotCaptureConfigured;
exports.peekSnapshot = peekSnapshot;
exports.resetSnapshotCaptureForTests = resetSnapshotCaptureForTests;
exports.seedSnapshotForTests = seedSnapshotForTests;
exports.subscribeToSnapshots = subscribeToSnapshots;
var _restorable_state = require("./restorable_state.js");
/**
 * Pictures of evicted roots, shown while they rebuild. Taken on the way out, because that is the frame the user
 * left, and filed under the root and the place in it they were taken at, so a root that moved on is not stood in
 * for by a picture of somewhere it no longer is.
 */

let configured;

/** Set once, at launch. Unset, nothing is photographed and every snapshot option is inert. */
function configureRestorationSnapshots(capture) {
  configured = capture;
}
function isSnapshotCaptureConfigured() {
  return configured !== undefined;
}

/** Orders captures: a timestamp cannot separate one taken during this eviction from one taken just before it. */
let captureSequence = 0;
function currentCaptureSequence() {
  return captureSequence;
}
const snapshots = new Map();

/** Every picture is a file on disk, so the store is bounded by recency. */
const MAX_SNAPSHOTS = 24;
const listeners = new Set();
function snapshotKey(rootKey, place) {
  return `${rootKey}|${place}`;
}
function report(message) {
  // eslint-disable-next-line no-console
  if ((0, _restorable_state.getIsRestorationDebugEnabled)()) console.log(`[restore-snapshot] ${message}`);
}
function dropSnapshot(key) {
  const snapshot = snapshots.get(key);
  if (!snapshot) return;
  snapshots.delete(key);
  try {
    configured?.release?.(snapshot.uri);
  } catch (error) {
    report(`release failed key=${key} error=${String(error)}`);
  }
}
function fileSnapshot(key, uri) {
  captureSequence += 1;
  // Re-inserted so the map orders by recency, since `set` on an existing key leaves it in place.
  dropSnapshot(key);
  snapshots.set(key, {
    uri,
    capturedAt: Date.now(),
    sequence: captureSequence
  });
  while (snapshots.size > MAX_SNAPSHOTS) {
    const oldest = snapshots.keys().next();
    if (oldest.done) break;
    dropSnapshot(oldest.value);
  }
  listeners.forEach(listener => listener());
}
function subscribeToSnapshots(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
async function captureSnapshot(rootKey, place, view) {
  const key = snapshotKey(rootKey, place);
  if (!configured || !view) {
    report(`skip key=${key} reason=${configured ? 'no-view' : 'not-configured'}`);
    return;
  }
  try {
    const uri = await configured.capture(view);
    fileSnapshot(key, uri);
    report(`captured key=${key} uri=${uri}`);
  } catch (error) {
    report(`failed key=${key} error=${String(error)}`);
  }
}

/** The picture filed under a place, if it was taken after `afterSequence`. */
function peekSnapshot(rootKey, place, afterSequence = -1) {
  const snapshot = snapshots.get(snapshotKey(rootKey, place));
  if (!snapshot || snapshot.sequence <= afterSequence) return undefined;
  return snapshot;
}

/** Drops every picture of a root, and deletes their files. */
function discardRestorationSnapshots(rootKey) {
  const prefix = `${rootKey}|`;
  for (const key of Array.from(snapshots.keys())) {
    if (key.startsWith(prefix)) {
      dropSnapshot(key);
      report(`discarded key=${key}`);
    }
  }
}
function clearSnapshots() {
  for (const key of Array.from(snapshots.keys())) dropSnapshot(key);
}
(0, _restorable_state.registerTestReset)(clearSnapshots);

/** Files a picture as if it had just been taken. */
function seedSnapshotForTests(rootKey, place, uri) {
  fileSnapshot(snapshotKey(rootKey, place), uri);
}
function resetSnapshotCaptureForTests() {
  configured = undefined;
}
//# sourceMappingURL=snapshots.js.map