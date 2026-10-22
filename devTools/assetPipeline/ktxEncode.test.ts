import { describe, expect, it } from 'vitest';
import { getKtxCreateArgs } from './ktxEncode';

// p619 D14: `ktx create`'s arguments decide the KTX2's bytes, so their order is fixed (a change
// needs a PIPELINE_VERSION bump: every output encodes again)

describe('getKtxCreateArgs', () => {
  it('UASTC, sRGB colour, with mipmaps, RDO and zstd', () => {
    const args = getKtxCreateArgs(
      {
        codec: 'uastc',
        maxSize: 1024,
        mipmaps: true,
        level: 2,
        rdo: 2,
        zstd: 18,
        normalMode: false,
      },
      { channels: 4, isSrgb: true, isNormal: false }
    );
    expect(args.join(' ')).toBe(
      '--format R8G8B8A8_SRGB --assign-tf srgb --assign-primaries bt709 --generate-mipmap --encode uastc --uastc-quality 2 --uastc-rdo --uastc-rdo-l 2 --zstd 18'
    );
  });

  it('a linear normal map in normal mode, its levels given (no RDO, no zstd)', () => {
    const args = getKtxCreateArgs(
      {
        codec: 'uastc',
        maxSize: null,
        mipmaps: true,
        level: 1,
        rdo: 0,
        zstd: 0,
        normalMode: true,
      },
      { channels: 3, isSrgb: false, isNormal: true, generateMipmap: false }
    );
    expect(args.join(' ')).toBe(
      '--format R8G8B8_UNORM --assign-tf linear --assign-primaries none --normalize --normal-mode --encode uastc --uastc-quality 1'
    );
  });

  it('ETC1S without mipmaps', () => {
    const args = getKtxCreateArgs(
      { codec: 'etc1s', maxSize: 512, mipmaps: false, quality: 128, normalMode: false },
      { channels: 3, isSrgb: true, isNormal: false }
    );
    expect(args.join(' ')).toBe(
      '--format R8G8B8_SRGB --assign-tf srgb --assign-primaries bt709 --encode basis-lz --qlevel 128'
    );
  });
});
