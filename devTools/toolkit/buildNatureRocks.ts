/* eslint-disable no-console -- a command-line script, its output is the log */
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { Document, Logger, NodeIO, type JSONDocument } from '@gltf-transform/core';
import { MeshoptSimplifier, type Flags } from 'meshoptimizer';
import { Matrix3, Matrix4, Vector3 } from 'three';
import { ROOT as REPO_ROOT } from '../paths';

/**
 * Builds the toolkit's imported scatter rocks (p308 D5) from Poly Haven models (CC0): each model's
 * 1k glTF downloaded into `.cache/polyhaven/<assetId>/` (checked against the files API's MD5),
 * each piece taken from one of its nodes, scaled, its base's centre moved to the origin (as
 * `generateRock`'s: its x and z centre, its lowest point) and decimated by meshoptimizer to its
 * kind's triangle budget (the UVs and normals of the vertices it keeps: the model's 1k maps, a
 * texture set of their own, still fit), written as a GLB of its pieces (a node and mesh each,
 * named as the scatter items name them, `<id>/<piece>`) into `src/toolkit/models/nature/<id>/`,
 * without materials or textures (the scatter's `rockScatter` material at the UV draws the set).
 * Run it when the pieces change and commit the GLBs:
 *
 *   source .claude/hooks/use-node.sh && npx tsx devTools/toolkit/buildNatureRocks.ts
 */

const CACHE_DIR = path.join(REPO_ROOT, '.cache/polyhaven');
const OUT_DIR = path.join(REPO_ROOT, 'src/toolkit/models/nature');
const RESOLUTION = '1k';

/** A piece of a model: its node in the source, its triangle budget and its scale */
type RockPiece = { name: string; source: string; maxTriangles: number; scale: number };
type NatureModel = { id: string; assetId: string; pieces: RockPiece[] };

/** The pebbles' and the rocks' budgets (`ROCK_TRIANGLE_BUDGETS`, the toolkit's geometry entry) */
const PEBBLE = 80;
const ROCK = 400;
const BOULDER = 1500;
/** The pebbles scaled up into rocks: 8-15 cm stones to 35-60 cm */
const ROCK_SCALE = 4;

const MODELS: NatureModel[] = [
  {
    id: 'namaqualandStones01',
    assetId: 'namaqualand_stones_01',
    pieces: [
      ...['a', 'b', 'c', 'd', 'e'].map((letter) => ({
        name: `Stone${letter.toUpperCase()}`,
        source: `namaqualand_stones_01_${letter}`,
        maxTriangles: PEBBLE,
        scale: 1,
      })),
      ...[
        ['A', 'b'],
        ['B', 'c'],
        ['C', 'e'],
      ].map(([name, letter]) => ({
        name: `Rock${name}`,
        source: `namaqualand_stones_01_${letter}`,
        maxTriangles: ROCK,
        scale: ROCK_SCALE,
      })),
    ],
  },
  // Not boulder_01 (p308 D5's candidate): 84 % of its vertices are on UV seams (a scan's many
  // islands), so it doesn't decimate under 54k triangles with its maps still fitting
  {
    id: 'namaqualandBoulder02',
    assetId: 'namaqualand_boulder_02',
    pieces: [{ name: 'Boulder', source: 'boulder_02', maxTriangles: BOULDER, scale: 1 }],
  },
];

/** The simplifier's attribute weights: the normal's three, the UV's two (positions are 1) */
const ATTRIBUTE_WEIGHTS = [0.5, 0.5, 0.5, 1, 1];
/**
 * The simplifier's flags: none. `Prune` takes a scan's UV islands for components of their own (all
 * removed at the error limit 1), and `Permissive` collapses across the UV seams, which smears the
 * maps over the islands the kept vertices took (boulder_01's swirls)
 */
const FLAGS: Flags[] = [];

type PolyHavenFile = { url: string; md5: string; include?: Record<string, PolyHavenFile> };

const md5 = (data: Uint8Array) => createHash('md5').update(data).digest('hex');

/** A URL's bytes, cached in `file`, checked against the MD5 when given */
const fetchCachedAsync = async (url: string, file: string, hash?: string) => {
  if (fs.existsSync(file)) {
    const cached = fs.readFileSync(file);
    if (!hash || md5(cached) === hash) return cached;
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (hash && md5(data) !== hash) throw new Error(`${url}: its MD5 isn't the files API's`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  console.log(`  downloaded ${url} (${(data.length / 1e6).toFixed(1)} MB)`);
  return data;
};

/** The model's 1k glTF with its buffer, read without its materials and textures */
const readModelAsync = async (assetId: string) => {
  const dir = path.join(CACHE_DIR, assetId);
  const listing = await fetchCachedAsync(
    `https://api.polyhaven.com/files/${assetId}`,
    path.join(dir, 'files.json')
  );
  const files = JSON.parse(listing.toString('utf8')) as {
    gltf: Record<string, { gltf: PolyHavenFile }>;
  };
  const gltf = files.gltf[RESOLUTION].gltf;
  const json = JSON.parse(
    (await fetchCachedAsync(gltf.url, path.join(dir, `${assetId}.gltf`), gltf.md5)).toString('utf8')
  ) as JSONDocument['json'];
  const resources: Record<string, Uint8Array> = {};
  for (const buffer of json.buffers ?? []) {
    const uri = buffer.uri as string;
    const include = gltf.include?.[uri];
    if (!include) throw new Error(`${assetId}: the files API has no "${uri}"`);
    resources[uri] = await fetchCachedAsync(include.url, path.join(dir, uri), include.md5);
  }
  // Geometry only: the maps are the texture set's (yarn fetchTextureSources)
  delete json.images;
  delete json.textures;
  delete json.samplers;
  delete json.materials;
  for (const mesh of json.meshes ?? []) for (const p of mesh.primitives) delete p.material;
  return new NodeIO().setLogger(new Logger(Logger.Verbosity.WARN)).readJSON({ json, resources });
};

/** A piece's geometry: positions and normals in the model's space × its scale, its base's centre at
 * the origin; its UVs and indices */
const readPiece = (source: Document, piece: RockPiece) => {
  const node = source
    .getRoot()
    .listNodes()
    .find((candidate) => candidate.getName() === piece.source);
  const primitive = node?.getMesh()?.listPrimitives()[0];
  if (!node || !primitive) throw new Error(`No mesh node "${piece.source}" in the source.`);
  const read = (name: string) => {
    const accessor = primitive.getAttribute(name);
    if (!accessor) throw new Error(`"${piece.source}" has no ${name}.`);
    return Float32Array.from(accessor.getArray() as ArrayLike<number>);
  };
  const positions = read('POSITION');
  const normals = read('NORMAL');
  const uvs = read('TEXCOORD_0');
  const indices = Uint32Array.from(primitive.getIndices()?.getArray() ?? []);
  const matrix = new Matrix4()
    .fromArray(node.getWorldMatrix())
    .premultiply(new Matrix4().makeScale(piece.scale, piece.scale, piece.scale));
  const normalMatrix = new Matrix3().getNormalMatrix(matrix);
  const v = new Vector3();
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < positions.length; i += 3) {
    v.fromArray(positions, i).applyMatrix4(matrix).toArray(positions, i);
    min.min(v);
    max.max(v);
    v.fromArray(normals, i).applyMatrix3(normalMatrix).normalize().toArray(normals, i);
  }
  const offset = [-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2];
  for (let i = 0; i < positions.length; i++) positions[i] += offset[i % 3];
  return { positions, normals, uvs, indices };
};

/** The piece decimated to its budget: the kept vertices' attributes, compacted */
const decimate = (geometry: ReturnType<typeof readPiece>, piece: RockPiece) => {
  const { positions, normals, uvs, indices } = geometry;
  const count = positions.length / 3;
  const attributes = new Float32Array(count * 5);
  for (let i = 0; i < count; i++) {
    attributes.set(normals.subarray(i * 3, i * 3 + 3), i * 5);
    attributes.set(uvs.subarray(i * 2, i * 2 + 2), i * 5 + 3);
  }
  {
    const [kept, error] = MeshoptSimplifier.simplifyWithAttributes(
      indices,
      positions,
      3,
      attributes,
      5,
      ATTRIBUTE_WEIGHTS,
      null,
      piece.maxTriangles * 3,
      1,
      FLAGS
    );
    if (kept.length / 3 > piece.maxTriangles) {
      throw new Error(
        `"${piece.name}" stops at ${kept.length / 3} triangles with its UV seams kept, over its ${piece.maxTriangles}: its maps need a bake onto new UVs, or another model.`
      );
    }
    const [remap, unique] = MeshoptSimplifier.compactMesh(kept);
    const pick = (array: Float32Array, size: number) => {
      const out = new Float32Array(unique * size);
      // The remap covers the vertices up to the largest index kept, each unused one ~0
      for (let i = 0; i < remap.length; i++) {
        if (remap[i] !== 0xffffffff)
          out.set(array.subarray(i * size, i * size + size), remap[i] * size);
      }
      return out;
    };
    return {
      positions: pick(positions, 3),
      normals: pick(normals, 3),
      uvs: pick(uvs, 2),
      indices: kept,
      sourceTriangles: indices.length / 3,
      error,
    };
  }
};

const buildModelAsync = async (model: NatureModel) => {
  console.log(`${model.id} (Poly Haven ${model.assetId}, ${RESOLUTION})`);
  const source = await readModelAsync(model.assetId);
  const doc = new Document();
  const buffer = doc.createBuffer();
  // Unnamed: GLTFLoader makes scene and node names unique together (the symbol's note)
  const scene = doc.createScene();
  for (const piece of model.pieces) {
    const simplified = decimate(readPiece(source, piece), piece);
    const accessor = (array: Float32Array | Uint32Array, type: 'VEC2' | 'VEC3' | 'SCALAR') =>
      doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
    const primitive = doc
      .createPrimitive()
      .setAttribute('POSITION', accessor(simplified.positions, 'VEC3'))
      .setAttribute('NORMAL', accessor(simplified.normals, 'VEC3'))
      .setAttribute('TEXCOORD_0', accessor(simplified.uvs, 'VEC2'))
      .setIndices(accessor(simplified.indices, 'SCALAR'));
    const mesh = doc.createMesh(piece.name).addPrimitive(primitive);
    scene.addChild(doc.createNode(piece.name).setMesh(mesh));
    const size = [0, 1, 2].map((axis) => {
      let low = Infinity;
      let high = -Infinity;
      for (let i = axis; i < simplified.positions.length; i += 3) {
        low = Math.min(low, simplified.positions[i]);
        high = Math.max(high, simplified.positions[i]);
      }
      return (high - low).toFixed(3);
    });
    console.log(
      `  ${piece.name}: ${simplified.sourceTriangles} → ${simplified.indices.length / 3} triangles (budget ${piece.maxTriangles}, error ${simplified.error.toFixed(4)}), ${size.join(' × ')} m`
    );
  }
  doc.getRoot().setDefaultScene(scene);
  doc.getRoot().getAsset().generator = 'Ækasha devTools/toolkit/buildNatureRocks.ts';
  const glb = await new NodeIO().writeBinary(doc);
  const file = path.join(OUT_DIR, model.id, `${model.id}.glb`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, glb);
  console.log(`  wrote ${path.relative(REPO_ROOT, file)} (${glb.byteLength} B)`);
};

const buildAsync = async () => {
  await MeshoptSimplifier.ready;
  for (const model of MODELS) await buildModelAsync(model);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildAsync().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
