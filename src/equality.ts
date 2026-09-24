/**
 * Structural equality for what `isRestorable` accepts — primitives, arrays, `Set`, `Map` and plain
 * objects — and identity for anything else, which a restorable value never contains.
 */
export function isRestorableEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => isRestorableEqual(value, b[index]));
  }
  if (a instanceof Set) {
    if (!(b instanceof Set) || a.size !== b.size) return false;
    for (const value of a) if (!b.has(value)) return false;
    return true;
  }
  if (a instanceof Map) {
    if (!(b instanceof Map) || a.size !== b.size) return false;
    for (const [key, value] of a) if (!b.has(key) || !isRestorableEqual(value, b.get(key))) return false;
    return true;
  }

  const prototype = Object.getPrototypeOf(a);
  if ((prototype !== Object.prototype && prototype !== null) || Object.getPrototypeOf(b) !== prototype) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && isRestorableEqual((a as any)[key], (b as any)[key]));
}
