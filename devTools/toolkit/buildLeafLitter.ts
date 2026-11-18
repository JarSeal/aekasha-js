/* eslint-disable no-console -- a command-line script, its output is the log */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { readZip } from '../assetPipeline/archives';
import { ROOT as REPO_ROOT } from '../paths';

/**
 * Builds the source image of the toolkit's leaf litter atlas (p308 D5,
 * `src/toolkit/textures/leafLitter/leafLitter.textureAtlas.json`) from ambientCG's LeafSet024
 * (CC0): its 1K-PNG download, cached in `.cache/ambientcg/`, its colour as RGB and its opacity as
 * A, written as one RGBA PNG the atlas's `albedo` slot names (its `image`). The atlas's nine cells
 * are the set's 3 × 3 leaves, cut at 340 and 684 px each way ({@link CUTS}); the script checks that
 * each leaf lies inside its cell's content (the rect inset by the atlas's padding) and throws
 * otherwise. Run it when the source changes and commit the PNG:
 *
 *   source .claude/hooks/use-node.sh && npx tsx devTools/toolkit/buildLeafLitter.ts
 */

const ASSET = 'LeafSet024_1K-PNG';
const URL = `https://ambientcg.com/get?file=${ASSET}.zip`;
const CACHE_FILE = path.join(REPO_ROOT, '.cache/ambientcg', `${ASSET}.zip`);
const OUT_FILE = path.join(
  REPO_ROOT,
  'src/toolkit/textures/leafLitter/source/leafLitter_albedo.png'
);
const ATLAS_FILE = path.join(
  REPO_ROOT,
  'src/toolkit/textures/leafLitter/leafLitter.textureAtlas.json'
);
const SIZE = 1024;
/** The cells' edges along each axis, px: the 3 × 3 grid the set's leaves lie on */
const CUTS = [0, 340, 684, SIZE];
/** An opacity over this is the leaf (the map is 0 or 255 but for its antialiased edge) */
const LEAF_OPACITY = 127;

/** The zip's bytes, downloaded once */
const readArchiveAsync = async () => {
  if (fs.existsSync(CACHE_FILE)) return fs.readFileSync(CACHE_FILE);
  const response = await fetch(URL);
  if (!response.ok) throw new Error(`${URL}: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, data);
  console.log(`  downloaded ${URL} (${(data.length / 1e6).toFixed(1)} MB)`);
  return data;
};

/** Each cell's leaf bounds in the opacity map, checked against its content rect */
const checkCells = (opacity: Buffer, padding: number) => {
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const [x0, x1] = [CUTS[col], CUTS[col + 1]];
      const [y0, y1] = [CUTS[row], CUTS[row + 1]];
      let inside = 0;
      let outside = 0;
      for (let y = Math.max(0, y0 - padding); y < Math.min(SIZE, y1 + padding); y++) {
        for (let x = Math.max(0, x0 - padding); x < Math.min(SIZE, x1 + padding); x++) {
          if (opacity[y * SIZE + x] <= LEAF_OPACITY) continue;
          const isContent =
            x >= x0 + padding && x < x1 - padding && y >= y0 + padding && y < y1 - padding;
          // A pixel of this cell's band that belongs to it (the cuts split the gaps)
          const isOwn = x >= x0 && x < x1 && y >= y0 && y < y1;
          if (isContent) inside++;
          else if (isOwn) outside++;
        }
      }
      if (!inside || outside) {
        throw new Error(
          `Cell ${row},${col}: ${inside} leaf pixels in its content, ${outside} in its padding.`
        );
      }
    }
  }
};

const buildAsync = async () => {
  const entries = readZip(await readArchiveAsync());
  const read = (suffix: string) => {
    const entry = entries.find((candidate) => candidate.path === `${ASSET}_${suffix}.png`);
    if (!entry) throw new Error(`${ASSET}.zip has no _${suffix}.png`);
    return entry.data;
  };
  const opacity = await sharp(read('Opacity'))
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (opacity.info.width !== SIZE || opacity.info.height !== SIZE) {
    throw new Error(
      `The opacity map is ${opacity.info.width} × ${opacity.info.height}, not ${SIZE}².`
    );
  }
  const atlas = JSON.parse(fs.readFileSync(ATLAS_FILE, 'utf8')) as { padding: number };
  checkCells(opacity.data, atlas.padding);
  // RGB first: sharp applies removeAlpha after joinChannel, which would drop the opacity
  const rgb = await sharp(read('Color')).removeAlpha().raw().toBuffer();
  const png = await sharp(rgb, { raw: { width: SIZE, height: SIZE, channels: 3 } })
    .joinChannel(opacity.data, { raw: { width: SIZE, height: SIZE, channels: 1 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const channels = (await sharp(png).metadata()).channels;
  if (channels !== 4) throw new Error(`The written image has ${channels} channels, not RGBA.`);
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, png);
  console.log(
    `Wrote ${path.relative(REPO_ROOT, OUT_FILE)} (${png.byteLength} B): 9 leaves checked`
  );
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildAsync().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
