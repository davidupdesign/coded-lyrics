/**
 * Small deterministic integer hash, shared by the gap jitter and the
 * transitions. Every visual effect derives its randomness from this so a given
 * timestamp always paints the same frame — which is what makes seeking look
 * correct instead of resampling noise on every scrub.
 */

export function hashSeed(n: number): number {
  let h = n | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash of a 2D coordinate plus a seed, as a float in [0, 1). */
export function hash01(x: number, y: number, seed: number): number {
  return hashSeed(x * 73856093 + y * 19349663 + seed * 83492791) / 0x100000000;
}
