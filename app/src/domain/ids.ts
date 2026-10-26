/** Stable, collision-resistant local IDs. Sortable by creation time. */
let counter = Math.floor(Math.random() * 4096);

function rand(n: number): string {
  let s = '';
  for (let i = 0; i < n; i += 1) s += Math.floor(Math.random() * 36).toString(36);
  return s;
}

export function newId(prefix: string): string {
  counter = (counter + 1) % 4096;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36).padStart(3, '0')}${rand(6)}`;
}

/**
 * Idempotency key for a user action. The caller derives it from the *intent*
 * (what, which baby, which instant) so that an accidental double-tap or a retry
 * after an ambiguous failure cannot create two facts.
 */
export function opIdFor(parts: (string | number | null | undefined)[]): string {
  const raw = parts.map((p) => (p === null || p === undefined ? '~' : String(p))).join('|');
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < raw.length; i += 1) {
    h1 ^= raw.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (Math.imul(h2 ^ raw.charCodeAt(i), 0x85ebca6b) >>> 0) + i;
    h2 >>>= 0;
  }
  return `op_${h1.toString(36)}${h2.toString(36)}_${raw.length.toString(36)}`;
}
