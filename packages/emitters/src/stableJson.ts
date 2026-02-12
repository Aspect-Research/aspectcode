/**
 * Stable JSON stringification.
 *
 * Ensures deterministic key ordering for objects (recursively) without
 * adding any external dependency.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null) return false;
  if (typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }

  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeysDeep(value[key]);
    }
    return out;
  }

  return value;
}

/**
 * Stable JSON stringify with sorted keys.
 *
 * @param value Any JSON-serializable value
 * @param space Indentation (defaults to 2, matching existing outputs)
 */
export function stableStringify(value: unknown, space: number = 2): string {
  return JSON.stringify(sortKeysDeep(value), null, space);
}
