/**
 * The extension of a file name (the text after its last `.`), or null for anything but a string.
 * @internal
 */
export const getFileNameExt = (fileName?: unknown) => {
  if (typeof fileName !== 'string') return null;
  const splitFileName = (fileName || '').split('.');
  return splitFileName[splitFileName.length - 1];
};

/**
 * Whether a file name has an `.hdr` extension (any case).
 * @internal
 */
export const isHDR = (fileName?: unknown) =>
  String(getFileNameExt(fileName)).toLowerCase() === 'hdr';

/**
 * Whether a file name or URL has a `.ktx2` extension (any case; a URL's query and hash ignored).
 * @internal
 */
export const isKTX2 = (fileName?: unknown) =>
  typeof fileName === 'string' &&
  String(getFileNameExt(fileName.split(/[?#]/)[0])).toLowerCase() === 'ktx2';
