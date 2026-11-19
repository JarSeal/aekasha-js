// The terrain gallery's Decals row (p309 Phase 1): the toolkit's two decal atlases in the DECAL
// packing, `decalsGround` and `decalsStructure` (which the scene lists), each shown whole on flat
// panels right of the Live block, one per view of its slots, every cell outlined and named over
// it (a canvas texture from the slot's cell table). Unlit (`BASICNODEMATERIAL`), so a panel shows
// the stored values: the albedo over a ground colour by its alpha, the opacity, the normal XY and
// roughness (`normalRough`'s RGB) and the puddle mask (its A). The atlases as built, until Phase
// 2's decal material draws their cells as decals.
import * as THREE from 'three/webgpu';
import { mix, sRGBTransferEOTF, texture, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import {
  createMaterial,
  createMeshEntity,
  getGeometry,
  getTexture,
  getTextureAtlasInfo,
  saveBufferGeometry,
  saveTexture,
} from 'aekasha';
import { BLOCK_GAP, NO_SHADOWS } from './galleryBlocks';
import { LIVE_BLOCK_BOUNDS } from './liveBlock';

/** A panel's view of an atlas's slots */
export type DecalsView = 'ALBEDO' | 'OPACITY' | 'NORMAL_ROUGH' | 'PUDDLE';

/** The views, in the row's order (left to right) */
export const DECALS_VIEWS: readonly { view: DecalsView; title: string }[] = [
  { view: 'ALBEDO', title: 'albedo over ground' },
  { view: 'OPACITY', title: 'opacity' },
  { view: 'NORMAL_ROUGH', title: 'normal XY, roughness' },
  { view: 'PUDDLE', title: 'puddle mask' },
];

/** An atlas of the row: its id and its panels' size in metres (the layout's aspect) */
type DecalsAtlas = { id: string; title: string; width: number; depth: number };

const ATLASES: readonly DecalsAtlas[] = [
  { id: 'decalsGround', title: 'Ground decals', width: 8, depth: 8 },
  { id: 'decalsStructure', title: 'Structure decals', width: 8, depth: 4 },
];

const PANEL_GAP = 2;
/** The gallery ground's top (`terrainGallery.ts`' ground), and the panels just above it */
const GROUND_TOP = -0.6;
const PANEL_Y = GROUND_TOP + 0.01;
/** The albedo view's ground under a decal (sRGB) */
const ALBEDO_GROUND = '#6b6150';
/** The labels canvas's width in px (its height by the atlas's aspect) */
const LABELS_WIDTH = 1024;

/** The row's first panel's left edge: right of the Live block */
const ROW_MIN_X = LIVE_BLOCK_BOUNDS.maxX + 2 * BLOCK_GAP;
const ROW_MIN_Z = LIVE_BLOCK_BOUNDS.minZ;
const ROW_WIDTH = DECALS_VIEWS.length * ATLASES[0].width + (DECALS_VIEWS.length - 1) * PANEL_GAP;
const ROW_DEPTH =
  ATLASES.reduce((sum, atlas) => sum + atlas.depth, 0) + (ATLASES.length - 1) * PANEL_GAP;

/** The row's extent on the ground, for the gallery's ground */
export const DECALS_ROW_BOUNDS = {
  minX: ROW_MIN_X,
  maxX: ROW_MIN_X + ROW_WIDTH,
  minZ: ROW_MIN_Z,
  maxZ: ROW_MIN_Z + ROW_DEPTH,
};

/** A panel: its atlas and view, and its centre on the ground */
export type DecalsPanel = {
  atlas: DecalsAtlas;
  view: DecalsView;
  title: string;
  x: number;
  z: number;
};

/** The panels, an atlas per row from the back (−z), its views left to right */
export const DECALS_PANELS: readonly DecalsPanel[] = ATLASES.flatMap((atlas, row) => {
  const z =
    ROW_MIN_Z +
    ATLASES.slice(0, row).reduce((sum, { depth }) => sum + depth + PANEL_GAP, 0) +
    atlas.depth / 2;
  return DECALS_VIEWS.map(({ view, title }, col) => ({
    atlas,
    view,
    title: `${atlas.title}: ${title}`,
    x: ROW_MIN_X + col * (atlas.width + PANEL_GAP) + atlas.width / 2,
    z,
  }));
});

/** A panel's mesh entity's app id */
export const getDecalsPanelAppId = ({ atlas, view }: DecalsPanel) =>
  `terrainGallery_decals_${atlas.id}_${view}`;

/** An atlas slot's texture: the scene lists the atlas, so its slots are loaded */
const getSlot = (atlasId: string, slot: string) => {
  const slotTexture = getTexture(`${atlasId}.${slot}`);
  if (!slotTexture) {
    throw new Error(`The terrainGallery scene needs the "${atlasId}" atlas in its textures.`);
  }
  return slotTexture;
};

/** Each cell of the atlas outlined and named, transparent elsewhere, over the panel's UVs */
const createLabelsTexture = (atlas: DecalsAtlas, slotTexture: THREE.Texture) => {
  const info = getTextureAtlasInfo(slotTexture);
  const width = LABELS_WIDTH;
  const height = Math.round((LABELS_WIDTH * atlas.depth) / atlas.width);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx && info) {
    ctx.font = '600 18px sans-serif';
    ctx.textBaseline = 'top';
    for (const [cellId, { uv }] of Object.entries(info.cells)) {
      // The cell table's UVs are v up; the canvas's rows go down (a CanvasTexture flips them back)
      const [u0, v0, u1, v1] = uv;
      const x = u0 * width;
      const y = (1 - v1) * height;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.strokeRect(x, y, (u1 - u0) * width, (v1 - v0) * height);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.strokeRect(x, y, (u1 - u0) * width, (v1 - v0) * height);
      const textWidth = ctx.measureText(cellId).width;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(x + 3, y + 3, textWidth + 8, 24);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(cellId, x + 7, y + 6);
    }
  }
  const labels = new THREE.CanvasTexture(canvas);
  labels.colorSpace = THREE.SRGBColorSpace;
  return labels;
};

/** The atlas's labels texture, registered (the scene's: released with it) */
const getLabelsTexture = (atlas: DecalsAtlas) => {
  const id = `terrainGallery_decals_${atlas.id}_labels`;
  return (
    getTexture(id) ?? saveTexture(createLabelsTexture(atlas, getSlot(atlas.id, 'albedoAlpha')), id)
  );
};

// A texture node's own type is three's (`Node<Vector3>` swizzles), and `sRGBTransferEOTF` returns
// an untyped node: both cast to what they are
const sampleVec4 = (tex: THREE.Texture) => texture(tex) as unknown as Node<'vec4'>;
const toStored = (value: Node<'vec3'>) => sRGBTransferEOTF(value) as unknown as Node<'vec3'>;

/**
 * A view's colour of a `DECAL` packing's two samples: the stored values shown as they are (data
 * through the output's sRGB curve's inverse, so a grey of 0.5 reads 128); the albedo over a ground
 * colour by its alpha
 */
export const getDecalViewColor = (
  albedoAlpha: Node<'vec4'>,
  normalRough: Node<'vec4'>,
  view: DecalsView
): Node<'vec3'> => {
  if (view === 'ALBEDO') {
    const ground = new THREE.Color(ALBEDO_GROUND);
    return mix(vec3(ground.r, ground.g, ground.b), albedoAlpha.rgb, albedoAlpha.a);
  }
  if (view === 'OPACITY') return toStored(vec3(albedoAlpha.a));
  if (view === 'NORMAL_ROUGH') return toStored(normalRough.rgb);
  return toStored(vec3(normalRough.a));
};

const getPanelMaterial = (panel: DecalsPanel) => {
  const material = createMaterial({
    id: `${getDecalsPanelAppId(panel)}_mat`,
    type: 'BASICNODEMATERIAL',
    params: {},
  }) as THREE.MeshBasicNodeMaterial;
  const labels = sampleVec4(getLabelsTexture(panel.atlas));
  const albedoAlpha = sampleVec4(getSlot(panel.atlas.id, 'albedoAlpha'));
  const normalRough = sampleVec4(getSlot(panel.atlas.id, 'normalRough'));
  const color = getDecalViewColor(albedoAlpha, normalRough, panel.view);
  material.colorNode = mix(color, labels.rgb, labels.a);
  material.needsUpdate = true;
  return material;
};

/** A panel's flat quad, facing up, its UVs' v toward the back (−z) */
const getPanelGeometry = ({ width, depth }: DecalsAtlas) => {
  const id = `terrainGallery_decalsPanel_${width}x${depth}`;
  return (
    getGeometry(id) ??
    saveBufferGeometry(new THREE.PlaneGeometry(width, depth).rotateX(-Math.PI / 2), { id })
  );
};

/** Creates the row's panels; the scene lists both atlases, so their slots are loaded */
export const createDecalsRow = () => {
  for (const panel of DECALS_PANELS) {
    createMeshEntity(
      {
        geo: getPanelGeometry(panel.atlas),
        mat: getPanelMaterial(panel),
        position: { x: panel.x, y: PANEL_Y, z: panel.z },
        ...NO_SHADOWS,
      },
      { appId: getDecalsPanelAppId(panel), debugData: { name: `Decals: ${panel.title}` } }
    );
  }
};
