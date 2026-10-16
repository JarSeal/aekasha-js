/** FNV-1a's 32-bit offset basis, {@link hashStringFNV1a}'s default start. */
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * FNV-1a, 32 bits, over a string's UTF-16 code units: a fast, stable hash for short keys (ids,
 * cache keys, stream names), not for security. Equal strings give equal hashes in every run.
 * @internal
 * @param text the string to hash
 * @param basis the start value: FNV-1a's offset basis, or one mixed with a seed
 * @returns the hash as an unsigned 32-bit integer
 */
export const hashStringFNV1a = (text: string, basis = FNV_OFFSET_BASIS) => {
  let hash = basis;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
};
