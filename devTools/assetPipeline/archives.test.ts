import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readAr, readCpio, readTar, readXar, readZip } from './archives';

// p619 D14: the readers `yarn setupAssetTools` unpacks KTX-Software's releases with, and p303 D5's
// zip reader (`yarn fetchTextureSources`), on archives built here byte by byte

const pad = (text: string, length: number) => text.padEnd(length, ' ').slice(0, length);

const ar = (members: { name: string; data: Buffer }[]) =>
  Buffer.concat([
    Buffer.from('!<arch>\n', 'latin1'),
    ...members.flatMap(({ name, data }) => [
      Buffer.from(
        `${pad(`${name}/`, 16)}${pad('0', 12)}${pad('0', 6)}${pad('0', 6)}${pad('100644', 8)}${pad(String(data.length), 10)}\`\n`,
        'latin1'
      ),
      data,
      ...(data.length % 2 ? [Buffer.from('\n')] : []),
    ]),
  ]);

const tarHeader = (
  name: string,
  size: number,
  opts: { mode?: number; type?: string; link?: string } = {}
) => {
  const header = Buffer.alloc(512);
  header.write(name, 0, 'utf8');
  header.write(`${(opts.mode ?? 0o644).toString(8).padStart(7, '0')}\0`, 100, 'latin1');
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'latin1');
  header.write(opts.type ?? '0', 156, 'latin1');
  if (opts.link) header.write(opts.link, 157, 'utf8');
  header.write('ustar\0', 257, 'latin1');
  return header;
};

const tar = (
  entries: { name: string; data?: Buffer; mode?: number; type?: string; link?: string }[]
) =>
  Buffer.concat([
    ...entries.flatMap((entry) => {
      const data = entry.data ?? Buffer.alloc(0);
      const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
      return [tarHeader(entry.name, data.length, entry), data, padding];
    }),
    Buffer.alloc(1024),
  ]);

const cpioEntry = (name: string, mode: number, data: Buffer) => {
  const octal = (value: number, length: number) => value.toString(8).padStart(length, '0');
  const header =
    '070707' +
    octal(0, 6) +
    octal(0, 6) +
    octal(mode, 6) +
    octal(0, 6) +
    octal(0, 6) +
    octal(1, 6) +
    octal(0, 6) +
    octal(0, 11) +
    octal(name.length + 1, 6) +
    octal(data.length, 11);
  return Buffer.concat([Buffer.from(header, 'latin1'), Buffer.from(`${name}\0`), data]);
};

type ZipInput = {
  name: string;
  data?: Buffer;
  method?: 0 | 8;
  /** A Unix mode in the attributes (made by Unix) */
  mode?: number;
  /** Local header sizes 0, as with a data descriptor (the central directory has them) */
  isStreamed?: boolean;
  crc?: number;
};

const zip = (inputs: ZipInput[]) => {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const input of inputs) {
    const data = input.data ?? Buffer.alloc(0);
    const method = input.method ?? 0;
    const stored = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = input.crc ?? zlib.crc32(data);
    const name = Buffer.from(input.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(input.isStreamed ? 0x808 : 0x800, 6);
    local.writeUInt16LE(method, 8);
    if (!input.isStreamed) {
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(stored.length, 18);
      local.writeUInt32LE(data.length, 22);
    }
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(((input.mode ? 3 : 0) << 8) | 20, 4);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(input.mode ? (0o100000 | input.mode) * 0x10000 : 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, stored);
    centrals.push(central, name);
    offset += local.length + name.length + stored.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(inputs.length, 8);
  end.writeUInt16LE(inputs.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end, Buffer.from('a comment')]);
};

describe('the archive readers', () => {
  it('readAr reads members, 2-byte aligned', () => {
    const members = readAr(
      ar([
        { name: 'debian-binary', data: Buffer.from('2.0\n') },
        { name: 'data.tar.gz', data: Buffer.from('odd') },
        { name: 'last', data: Buffer.from('x') },
      ])
    );
    expect(members.map(({ name, data }) => [name, data.toString()])).toEqual([
      ['debian-binary', '2.0\n'],
      ['data.tar.gz', 'odd'],
      ['last', 'x'],
    ]);
    expect(() => readAr(Buffer.from('not an archive'))).toThrow('Not an ar archive');
  });

  it('readTar reads files and links, gzipped or not', () => {
    const archive = tar([
      { name: './usr/bin/ktx', data: Buffer.from('binary'), mode: 0o755 },
      { name: './usr/lib/libktx.so', type: '2', link: 'libktx.so.4' },
    ]);
    for (const input of [archive, zlib.gzipSync(archive)]) {
      expect(readTar(input)).toEqual([
        { path: 'usr/bin/ktx', data: Buffer.from('binary'), mode: 0o755 },
        expect.objectContaining({ path: 'usr/lib/libktx.so', linkTarget: 'libktx.so.4' }),
      ]);
    }
  });

  it('readCpio reads an odc archive up to its trailer', () => {
    const archive = Buffer.concat([
      cpioEntry('./bin/ktx', 0o100755, Buffer.from('binary')),
      cpioEntry('./lib/libktx.dylib', 0o120755, Buffer.from('libktx.4.dylib')),
      cpioEntry('TRAILER!!!', 0, Buffer.alloc(0)),
    ]);
    expect(readCpio(zlib.gzipSync(archive))).toEqual([
      { path: 'bin/ktx', data: Buffer.from('binary'), mode: 0o755 },
      {
        path: 'lib/libktx.dylib',
        data: Buffer.alloc(0),
        mode: 0o755,
        linkTarget: 'libktx.4.dylib',
      },
    ]);
    expect(() => readCpio(Buffer.from('pbzx....'))).toThrow(/pbzx/);
  });

  it('readXar reads its leaf files from the heap', () => {
    const payload = zlib.deflateSync(Buffer.from('payload'));
    const plain = Buffer.from('plain');
    const toc = `<?xml version="1.0"?><xar><toc>
<file id="1"><name>pkg</name>
  <file id="2"><name>Payload</name><data><offset>0</offset><length>${payload.length}</length><encoding style="application/x-gzip"/></data></file>
</file>
<file id="3"><name>Distribution</name><data><offset>${payload.length}</offset><length>${plain.length}</length><encoding style="application/octet-stream"/></data></file>
</toc></xar>`;
    const tocBytes = zlib.deflateSync(Buffer.from(toc));
    const header = Buffer.alloc(28);
    header.write('xar!', 0, 'latin1');
    header.writeUInt16BE(28, 4);
    header.writeBigUInt64BE(BigInt(tocBytes.length), 8);
    const files = readXar(Buffer.concat([header, tocBytes, payload, plain]));
    expect(files.map(({ name, data }) => [name, data.toString()])).toEqual([
      ['Payload', 'payload'],
      ['Distribution', 'plain'],
    ]);
  });
  it('readZip reads stored and deflated files, checked against their CRC-32', () => {
    const color = Buffer.from('jpeg bytes '.repeat(50));
    const entries = readZip(
      zip([
        { name: 'Ground080_2K-JPG/' },
        { name: 'Ground080_2K-JPG/Ground080_2K-JPG_Color.jpg', data: color, method: 8 },
        { name: 'Ground080.png', data: Buffer.from('preview'), mode: 0o600 },
        { name: 'Ground080_2K-JPG_NormalGL.jpg', data: color, method: 8, isStreamed: true },
      ])
    );
    expect(entries).toEqual([
      { path: 'Ground080_2K-JPG/Ground080_2K-JPG_Color.jpg', data: color, mode: 0o644 },
      { path: 'Ground080.png', data: Buffer.from('preview'), mode: 0o600 },
      { path: 'Ground080_2K-JPG_NormalGL.jpg', data: color, mode: 0o644 },
    ]);
  });

  it('readZip throws for a corrupt, truncated or foreign archive', () => {
    expect(() => readZip(Buffer.from('not an archive, long enough for the end record'))).toThrow(
      'Not a zip archive'
    );
    expect(() => readZip(zip([{ name: 'a.jpg', data: Buffer.from('abc'), crc: 1 }]))).toThrow(
      /"a.jpg" fails its size or CRC-32 check/
    );
    const archive = zip([{ name: 'a.jpg', data: Buffer.from('abc') }]);
    // The data's first byte gone: the central directory points past the shortened file
    const truncated = Buffer.concat([archive.subarray(0, 35), archive.subarray(36)]);
    expect(() => readZip(truncated)).toThrow(/Corrupt zip/);
  });
});
