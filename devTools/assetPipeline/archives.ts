import zlib from 'zlib';

/**
 * Minimal readers for the archive formats the KTX-Software releases ship in, so the tools can be
 * unpacked with Node alone (no `tar`, `bzip2`, `ar` or `pkgutil` needed):
 * - Linux `.deb`: an `ar` archive whose `data.tar.gz` holds the files;
 * - macOS `.pkg`: a `xar` archive whose component packages each hold a gzipped `cpio` Payload.
 * And the `.zip` downloads `yarn fetchTextureSources` unpacks (ambientCG's, p303 D5).
 * Only what those archives use is supported; anything else throws.
 */

export type ArchiveEntry = {
  /** Path inside the archive, without a leading `./` */
  path: string;
  data: Buffer;
  /** Unix permission bits */
  mode: number;
  /** Set for a symbolic link (relative to the link's own directory) */
  linkTarget?: string;
};

const normalizePath = (p: string) => p.replace(/^\.?\//, '');

/** Reads the members of an `ar` archive (the `.deb` container). */
export const readAr = (buf: Buffer) => {
  if (buf.toString('latin1', 0, 8) !== '!<arch>\n') throw new Error('Not an ar archive');
  const members: { name: string; data: Buffer }[] = [];
  let pos = 8;
  while (pos + 60 <= buf.length) {
    const name = buf
      .toString('latin1', pos, pos + 16)
      .trim()
      .replace(/\/$/, '');
    const size = parseInt(buf.toString('latin1', pos + 48, pos + 58).trim(), 10);
    pos += 60;
    members.push({ name, data: buf.subarray(pos, pos + size) });
    pos += size + (size % 2); // Members are 2-byte aligned
  }
  return members;
};

const readOctal = (buf: Buffer, start: number, end: number) =>
  parseInt(buf.toString('latin1', start, end).replace(/\0.*$/s, '').trim() || '0', 8);

const readCString = (buf: Buffer, start: number, end: number) =>
  buf.toString('utf8', start, end).replace(/\0.*$/s, '');

/** Reads a (ustar / GNU) tar archive, gunzipping it first when it is gzipped. */
export const readTar = (input: Buffer) => {
  const buf = input[0] === 0x1f && input[1] === 0x8b ? zlib.gunzipSync(input) : input;
  const entries: ArchiveEntry[] = [];
  let pos = 0;
  let longName: string | null = null;
  while (pos + 512 <= buf.length) {
    if (buf[pos] === 0) break; // End-of-archive block
    const header = buf.subarray(pos, pos + 512);
    const size = readOctal(header, 124, 136);
    const mode = readOctal(header, 100, 108) & 0o7777;
    const type = header[156] ? String.fromCharCode(header[156]) : '0';
    const prefix = readCString(header, 345, 500);
    const linkTarget = readCString(header, 157, 257);
    let name = readCString(header, 0, 100);
    if (prefix) name = `${prefix}/${name}`;
    const data = buf.subarray(pos + 512, pos + 512 + size);
    pos += 512 + Math.ceil(size / 512) * 512;

    if (type === 'L') {
      longName = readCString(data, 0, data.length);
      continue;
    }
    if (type === 'x' || type === 'g') continue; // Pax headers: nothing these archives need
    if (longName) {
      name = longName;
      longName = null;
    }
    if (type === '0') entries.push({ path: normalizePath(name), data, mode });
    else if (type === '2') {
      entries.push({ path: normalizePath(name), data: Buffer.alloc(0), mode, linkTarget });
    }
  }
  return entries;
};

/** Reads an old-style portable (odc, `070707`) cpio archive, the format of a `.pkg` Payload. */
export const readCpio = (input: Buffer) => {
  if (input.toString('latin1', 0, 4) === 'pbzx') {
    throw new Error('pbzx-compressed pkg payloads are not supported');
  }
  const buf = input[0] === 0x1f && input[1] === 0x8b ? zlib.gunzipSync(input) : input;
  const entries: ArchiveEntry[] = [];
  let pos = 0;
  while (pos + 76 <= buf.length) {
    if (buf.toString('latin1', pos, pos + 6) !== '070707') {
      throw new Error(`Unsupported cpio format at byte ${pos}`);
    }
    const mode = parseInt(buf.toString('latin1', pos + 18, pos + 24), 8);
    const nameSize = parseInt(buf.toString('latin1', pos + 59, pos + 65), 8);
    const fileSize = parseInt(buf.toString('latin1', pos + 65, pos + 76), 8);
    const name = buf.toString('utf8', pos + 76, pos + 76 + nameSize - 1);
    pos += 76 + nameSize;
    const data = buf.subarray(pos, pos + fileSize);
    pos += fileSize;
    if (name === 'TRAILER!!!') break;

    const fileType = mode & 0o170000;
    if (fileType === 0o100000) {
      entries.push({ path: normalizePath(name), data, mode: mode & 0o7777 });
    } else if (fileType === 0o120000) {
      entries.push({
        path: normalizePath(name),
        data: Buffer.alloc(0),
        mode: mode & 0o7777,
        linkTarget: data.toString('utf8'),
      });
    }
  }
  return entries;
};

/**
 * Reads the files of a `xar` archive (the `.pkg` container): returns each leaf file's name and
 * its (zlib-decoded when stored so) data. Names are not unique: every component package of a
 * `.pkg` has its own `Payload`.
 */
export const readXar = (buf: Buffer) => {
  if (buf.toString('latin1', 0, 4) !== 'xar!') throw new Error('Not a xar archive');
  const headerSize = buf.readUInt16BE(4);
  const tocLength = Number(buf.readBigUInt64BE(8));
  const toc = zlib.inflateSync(buf.subarray(headerSize, headerSize + tocLength)).toString('utf8');
  const heapStart = headerSize + tocLength;

  const files: { name: string; data: Buffer }[] = [];
  // Innermost <file> elements only (a directory's <file> contains other <file>s)
  const leafRegex = /<file id="\d+">((?:(?!<file[\s>])[\s\S])*?)<\/file>/g;
  for (const [, body] of toc.matchAll(leafRegex)) {
    const name = body.match(/<name>([^<]*)<\/name>/)?.[1];
    const dataBlock = body.match(/<data>([\s\S]*?)<\/data>/)?.[1];
    if (!name || !dataBlock) continue;
    const offset = Number(dataBlock.match(/<offset>(\d+)<\/offset>/)?.[1]);
    const length = Number(dataBlock.match(/<length>(\d+)<\/length>/)?.[1]);
    const encoding = dataBlock.match(/<encoding style="([^"]+)"/)?.[1] || '';
    let data = buf.subarray(heapStart + offset, heapStart + offset + length);
    if (encoding === 'application/x-gzip') data = zlib.inflateSync(data);
    else if (encoding !== 'application/octet-stream') {
      throw new Error(`Unsupported xar encoding "${encoding}" (${name})`);
    }
    files.push({ name, data });
  }
  return files;
};

const ZIP_END_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
/** The end record's fixed part; a comment of up to 65,535 bytes follows it */
const ZIP_END_SIZE = 22;

/**
 * Reads the files of a `.zip` archive (p303 D5: ambientCG's downloads), each checked against its
 * CRC-32 and size, so a truncated or corrupt download throws instead of yielding a broken image.
 * Stored and deflated entries only; folders are skipped. Throws for a Zip64, encrypted or
 * multi-disk archive and for any other compression method.
 */
export const readZip = (buf: Buffer) => {
  let end = -1;
  const lowest = Math.max(0, buf.length - ZIP_END_SIZE - 0xffff);
  for (let pos = buf.length - ZIP_END_SIZE; pos >= lowest; pos--) {
    if (buf.readUInt32LE(pos) === ZIP_END_SIGNATURE) {
      end = pos;
      break;
    }
  }
  if (end < 0) throw new Error('Not a zip archive (no end of central directory record)');
  const count = buf.readUInt16LE(end + 10);
  const directoryOffset = buf.readUInt32LE(end + 16);
  if (count === 0xffff || directoryOffset === 0xffffffff) {
    throw new Error('Zip64 archives are not supported');
  }
  if (buf.readUInt16LE(end + 4) !== 0 || buf.readUInt16LE(end + 8) !== count) {
    throw new Error('Multi-disk zip archives are not supported');
  }

  const entries: ArchiveEntry[] = [];
  let pos = directoryOffset;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== ZIP_CENTRAL_SIGNATURE) {
      throw new Error(`Corrupt zip central directory at byte ${pos}`);
    }
    const madeBy = buf.readUInt16LE(pos + 4) >> 8;
    const flags = buf.readUInt16LE(pos + 8);
    const method = buf.readUInt16LE(pos + 10);
    const crc = buf.readUInt32LE(pos + 16);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const size = buf.readUInt32LE(pos + 24);
    const nameLength = buf.readUInt16LE(pos + 28);
    const extraLength = buf.readUInt16LE(pos + 30);
    const commentLength = buf.readUInt16LE(pos + 32);
    const externalAttributes = buf.readUInt32LE(pos + 38);
    const localOffset = buf.readUInt32LE(pos + 42);
    // Bit 11: the name is UTF-8; otherwise CP437, which matches latin1 for ASCII names
    const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', pos + 46, pos + 46 + nameLength);
    pos += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    if (flags & 0x1) throw new Error(`"${name}" is encrypted`);

    if (buf.readUInt32LE(localOffset) !== ZIP_LOCAL_SIGNATURE) {
      throw new Error(`Corrupt zip: "${name}" has no local header`);
    }
    // The local header's sizes may be 0 (a data descriptor follows the data): the central one's count
    const dataStart =
      localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    if (dataStart + compressedSize > buf.length) {
      throw new Error(`Truncated zip: "${name}" ends past the archive`);
    }
    const raw = buf.subarray(dataStart, dataStart + compressedSize);
    let data: Buffer;
    if (method === 0) data = raw;
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error(`"${name}": unsupported zip compression method ${method}`);
    if (data.length !== size || zlib.crc32(data) !== crc) {
      throw new Error(`Corrupt zip: "${name}" fails its size or CRC-32 check`);
    }
    // A Unix-made archive keeps the mode in the attributes' high 16 bits
    const mode =
      madeBy === 3 && externalAttributes >>> 16 ? (externalAttributes >>> 16) & 0o7777 : 0o644;
    entries.push({ path: normalizePath(name), data, mode });
  }
  return entries;
};
