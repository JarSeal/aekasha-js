/**
 * Returns the file name extension from a string
 * @param fileName (string) optional file name, if not provided then this will return null
 * @returns (string | null)
 */
export const getFileNameExt = (fileName?: unknown) => {
  if (typeof fileName !== 'string') return null;
  const splitFileName = (fileName || '').split('.');
  return splitFileName[splitFileName.length - 1];
};

/**
 * Determines whether the file name provided has an 'hdr' extension
 * @param fileName (string) optional file name
 * @returns (boolean)
 */
export const isHDR = (fileName?: unknown) =>
  String(getFileNameExt(fileName)).toLowerCase() === 'hdr';

/**
 * Determines whether the file name (or URL, its query and hash ignored) provided has a 'ktx2'
 * extension
 * @param fileName (string) optional file name
 * @returns (boolean)
 */
export const isKTX2 = (fileName?: unknown) =>
  typeof fileName === 'string' &&
  String(getFileNameExt(fileName.split(/[?#]/)[0])).toLowerCase() === 'ktx2';
