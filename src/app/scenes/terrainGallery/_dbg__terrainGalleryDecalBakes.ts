// The terrain gallery tab's procedural decals (p309 Phase 5, D5): a generated cell of the two decal
// atlases baked from its generator (`bakeDecalGenerator`, the cell's content size, its physical
// size), its seed and params in the tab, shown on the bake bench right of the stage
// (`DECALS_BENCH_BLOCK`, made with the first bake): as `BLEND` and `CUTOUT` decals at the cell's
// size and enlarged on the bench's wet mud and on its wall (decal materials of the toolkit's graph
// over the bake's textures, `setupDecalMaterial`), and on flat panels of the row's four views, the
// bake at the back and the atlas's own copy of the cell in front of it. The atlas JSON is each
// cell's recipe (its `data`'s `generator`, `seed` and `params`): "Copy cell data" copies the
// shown values as the cell's `data`, "Export cell" writes the shown bake's two slots as the cell's
// PNGs into its atlas's `source/`, and "Export all" every generated cell from its committed data.
import * as THREE from 'three/webgpu';
import { texture, uniform, uv } from 'three/tsl';
import type { Node, TextureNode, UniformNode } from 'three/webgpu';
import {
  createMaterial,
  createMeshEntity,
  deleteEntity,
  getGeometry,
  getTexture,
  getTextureAtlasInfo,
  lerror,
  saveBufferGeometry,
  type TextureAtlasInfo,
} from 'aekasha';
import {
  addDebugToast,
  updateDebuggerTab,
  type DebuggerPaneItem,
  type DebuggerTabSection,
} from 'aekasha/debug';
import {
  bakeDecalGenerator,
  decalCracks,
  decalFootprint,
  decalFormwork,
  decalIceCrack,
  decalLeafPatch,
  decalMudSplatter,
  decalScorch,
  decalStain,
  decalWetPatch,
  setupDecalMaterial,
  type BakedDecal,
  type DecalGenerator,
  type SurfaceParamSpec,
  type SurfaceParamValues,
} from 'aekasha/toolkit/terrain';
import { exportBakeOutputsAsync, type BakeOutputExport } from '../../shared/_dbg__exportBake';
import { flyGalleryCamera } from './_dbg__terrainGalleryCamera';
import { DECALS_VIEWS, getDecalViewColor } from './decalsRow';
import {
  createDecalsStageSurface,
  DECAL_RENDER_ORDER,
  DECALS_BENCH_BLOCK,
  getDecalQuadGeometry,
} from './decalsStage';
import { BLOCK_SIZE, NO_SHADOWS } from './galleryBlocks';

/** The atlases whose generated cells the tab bakes, with their titles */
const ATLASES = [
  { id: 'decalsGround', title: 'Ground' },
  { id: 'decalsStructure', title: 'Structure' },
] as const;

const GENERATORS: Record<string, DecalGenerator> = Object.fromEntries(
  [
    decalCracks,
    decalStain,
    decalScorch,
    decalMudSplatter,
    decalFootprint,
    decalWetPatch,
    decalIceCrack,
    decalLeafPatch,
    decalFormwork,
  ].map((generator) => [generator.id, generator as unknown as DecalGenerator])
);

type ParamValue = number | string | boolean;

/** A generated cell's `data`, as the atlas JSON gives it */
type CellData = {
  physicalSize?: [number, number];
  generator?: string;
  seed?: number;
  params?: Record<string, ParamValue>;
};

/** A cell of an atlas with a generator: its recipe and its size */
type GeneratedCell = {
  /** `<atlasId>/<cellId>`, the select's value */
  key: string;
  atlasId: string;
  atlasTitle: string;
  cellId: string;
  generator: DecalGenerator;
  /** Its content's size in px: the bake's */
  size: [number, number];
  physicalSize: [number, number];
  data: CellData;
};

/** The bakes' ids: each bake a new one (a live id would return the old bake, its options ignored) */
const BAKE_ID = 'terrainGallery_decalBake';
const EXPORT_ID = 'terrainGallery_decalExport';
/** The enlarged decals' longer side, metres */
const ENLARGED = 3;
/** The wall's enlarged decal's longer side, metres */
const WALL_ENLARGED = 2.4;
/** The data panels' side, metres, and their centres' x on the bench */
const PANEL_SIZE = 2;
const PANEL_XS = [-4.05, -1.35, 1.35, 4.05];
/** The panels' rows on the bench: the bake at the back, the atlas's copy in front of it */
const BAKE_PANEL_Z = -4.6;
const ATLAS_PANEL_Z = -2.2;
const PANEL_Y = 0.01;

/** The tab's bindings: the selected cell, its seed; the params are `paramValues` */
const state = { cell: '', seed: 0 };
let paramValues: Record<string, ParamValue> = {};
/** The read-only figures */
const figures = { status: '-' };

/** The bench's materials' texture nodes (their `value` swapped for each bake), its uniform and
 * the decals made for the shown cell */
type Bench = {
  bakeNodes: Record<'albedoAlpha' | 'normalRough', TextureNode[]>;
  atlasNodes: Record<'albedoAlpha' | 'normalRough', TextureNode[]>;
  cellRect: UniformNode<'vec4', THREE.Vector4>;
  materials: Record<'BLEND' | 'CUTOUT', THREE.MeshStandardNodeMaterial>;
  decalIds: number[];
};

let visit = { isCurrent: false };
let bench: Bench | null = null;
let shown: { decal: BakedDecal; cell: GeneratedCell } | null = null;
let bakeCount = 0;
/** Each cell's decals' app ids are their own (made before the last cell's go) */
let decalGeneration = 0;
let request = 0;
let isExporting = false;

const toGeneratedCell = (
  atlasId: string,
  atlasTitle: string,
  cellId: string,
  cell: TextureAtlasInfo['cells'][string]
): GeneratedCell | null => {
  const data = (cell.data ?? {}) as CellData;
  const generator = data.generator ? GENERATORS[data.generator] : undefined;
  if (!generator) return null;
  return {
    key: `${atlasId}/${cellId}`,
    atlasId,
    atlasTitle,
    cellId,
    generator,
    size: cell.size as [number, number],
    physicalSize: data.physicalSize ?? generator.physicalSize,
    data,
  };
};

/** The generated cells of both atlases (those whose `data.generator` is one of the nine) */
const getGeneratedCells = (): GeneratedCell[] =>
  ATLASES.flatMap(({ id: atlasId, title }) => {
    const slot = getTexture(`${atlasId}.albedoAlpha`);
    const info = slot ? getTextureAtlasInfo(slot) : undefined;
    return Object.entries(info?.cells ?? {}).flatMap(([cellId, cell]) => {
      const generated = toGeneratedCell(atlasId, title, cellId, cell);
      return generated ? [generated] : [];
    });
  });

/** Values for any generator (`DecalGenerator`'s params are its specs' union, read as numbers) */
const asParams = (values: Record<string, ParamValue>) =>
  values as SurfaceParamValues<DecalGenerator['params']>;

const getSelectedCell = () => getGeneratedCells().find((cell) => cell.key === state.cell);

const isStaticSpec = (spec: SurfaceParamSpec) =>
  spec.type === 'boolean' ||
  spec.type === 'choice' ||
  (spec.type !== 'color' && Boolean(spec.isStatic));

/** Every param's value: the given one, else its default */
const getFullParams = (generator: DecalGenerator, given: Record<string, ParamValue> = {}) =>
  Object.fromEntries(
    Object.entries(generator.params).map(([name, spec]) => [name, given[name] ?? spec.default])
  ) as Record<string, ParamValue>;

const isSameValue = (a: ParamValue, b: ParamValue) =>
  typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b;

/** The params that aren't their defaults: what a cell's `data.params` holds */
const getChangedParams = (generator: DecalGenerator) =>
  Object.fromEntries(
    Object.entries(generator.params).flatMap(([name, spec]) =>
      isSameValue(paramValues[name], spec.default) ? [] : [[name, paramValues[name]]]
    )
  );

/** Whether the shown seed and params are the cell's committed ones */
const isCommitted = (cell: GeneratedCell) => {
  if ((cell.data.seed ?? 0) !== state.seed) return false;
  const committed = getFullParams(cell.generator, cell.data.params);
  return Object.keys(committed).every((name) => isSameValue(committed[name], paramValues[name]));
};

const updateStatus = () => {
  const cell = shown?.cell;
  figures.status = cell
    ? `${cell.generator.id}, ${cell.size.join(' × ')} px: ${isCommitted(cell) ? "the cell's data" : "changed from the cell's data"}`
    : '-';
};

/** Selects a cell: its committed seed and params into the fields */
const selectCell = (cell: GeneratedCell) => {
  state.cell = cell.key;
  state.seed = cell.data.seed ?? 0;
  paramValues = getFullParams(cell.generator, cell.data.params);
};

const toast = (type: 'info' | 'warning' | 'alert', title: string, message: string) =>
  addDebugToast({ type, title, message, showingTime: type === 'info' ? 6000 : 15000 });

// --- The bench ---

const asNode = (node: TextureNode) => node as unknown as Node<'vec4'>;

/** A texture node of a bake's slot, kept so a later bake's texture replaces it */
const trackBakeNode = (
  nodes: Bench['bakeNodes'],
  slot: 'albedoAlpha' | 'normalRough',
  source: THREE.Texture
) => {
  const node = texture(source) as unknown as TextureNode;
  nodes[slot].push(node);
  return node;
};

const createBenchMaterial = (
  mode: 'BLEND' | 'CUTOUT',
  decal: BakedDecal,
  nodes: Bench['bakeNodes']
) => {
  const material = createMaterial({
    id: `terrainGallery_benchDecal_${mode}`,
    type: 'STANDARDNODEMATERIAL',
    params: { polygonOffsetFactor: -1, polygonOffsetUnits: -4 },
  }) as THREE.MeshStandardNodeMaterial;
  const ripples = getTexture('rippleAtlas');
  setupDecalMaterial(
    {
      albedoAlpha: trackBakeNode(nodes, 'albedoAlpha', decal.bake.textures.albedoAlpha),
      normalRough: trackBakeNode(nodes, 'normalRough', decal.bake.textures.normalRough),
      ...(ripples ? { ripples: texture(ripples) as unknown as TextureNode } : {}),
    },
    material,
    { mode, edgeFade: 'UV1', wet: 'FULL', frost: true, rainOcclusion: 'NORMAL_Y' }
  );
  material.needsUpdate = true;
  return material;
};

/** A data panel's flat quad, facing up, its v toward the back (as the row's) */
const getPanelGeometry = () => {
  const id = 'terrainGallery_benchPanel';
  return (
    getGeometry(id) ??
    saveBufferGeometry(new THREE.PlaneGeometry(PANEL_SIZE, PANEL_SIZE).rotateX(-Math.PI / 2), {
      id,
    })
  );
};

/** The two rows of panels: the bake's views at the back, the atlas cell's in front of them */
const createPanels = (
  decal: BakedDecal,
  cell: GeneratedCell,
  created: Omit<Bench, 'materials'>
) => {
  // The panel's uv into the cell's content rect
  const rect = created.cellRect as unknown as Node<'vec4'>;
  const panelUv = uv() as unknown as Node<'vec2'>;
  const cellUv = rect.xy.add(rect.zw.sub(rect.xy).mul(panelUv)) as Node<'vec2'>;
  const atlasNode = (slot: 'albedoAlpha' | 'normalRough') => {
    const source = getTexture(`${cell.atlasId}.${slot}`) as THREE.Texture;
    const node = texture(source, cellUv as never) as unknown as TextureNode;
    created.atlasNodes[slot].push(node);
    return node;
  };
  DECALS_VIEWS.forEach(({ view, title }, i) => {
    for (const isBake of [true, false]) {
      const albedoAlpha = isBake
        ? trackBakeNode(created.bakeNodes, 'albedoAlpha', decal.bake.textures.albedoAlpha)
        : atlasNode('albedoAlpha');
      const normalRough = isBake
        ? trackBakeNode(created.bakeNodes, 'normalRough', decal.bake.textures.normalRough)
        : atlasNode('normalRough');
      const name = `${isBake ? 'bake' : 'atlas'}_${view}`;
      const material = createMaterial({
        id: `terrainGallery_benchPanel_${name}`,
        type: 'BASICNODEMATERIAL',
        params: {},
      }) as THREE.MeshBasicNodeMaterial;
      material.colorNode = getDecalViewColor(asNode(albedoAlpha), asNode(normalRough), view);
      material.needsUpdate = true;
      createMeshEntity(
        {
          geo: getPanelGeometry(),
          mat: material,
          position: {
            x: DECALS_BENCH_BLOCK.x + PANEL_XS[i],
            y: PANEL_Y,
            z: DECALS_BENCH_BLOCK.z + (isBake ? BAKE_PANEL_Z : ATLAS_PANEL_Z),
          },
          ...NO_SHADOWS,
        },
        {
          appId: `terrainGallery_benchPanel_${name}`,
          debugData: { name: `Decal bench: ${isBake ? 'bake' : "atlas's copy"}, ${title}` },
        }
      );
    }
  });
};

/** Makes the bench (its block and wall, the decal materials, the panels) over the first bake */
const createBench = (decal: BakedDecal, cell: GeneratedCell): Bench => {
  createDecalsStageSurface({ ...DECALS_BENCH_BLOCK, title: 'bake bench' }, 'bench');
  const created: Omit<Bench, 'materials'> = {
    bakeNodes: { albedoAlpha: [], normalRough: [] },
    atlasNodes: { albedoAlpha: [], normalRough: [] },
    cellRect: uniform(new THREE.Vector4(0, 0, 1, 1)) as unknown as Bench['cellRect'],
    decalIds: [],
  };
  const materials = {
    BLEND: createBenchMaterial('BLEND', decal, created.bakeNodes),
    CUTOUT: createBenchMaterial('CUTOUT', decal, created.bakeNodes),
  };
  createPanels(decal, cell, created);
  return { ...created, materials };
};

/** A decal of the shown bake on the bench: on its ground (`x`, `z`) or its wall (`x`, `y`) */
const createBenchDecal = (
  current: Bench,
  opts: { mode: 'BLEND' | 'CUTOUT'; size: [number, number]; x: number; z?: number; y?: number }
) => {
  const onWall = opts.y !== undefined;
  const [width, depth] = opts.size;
  const position = onWall
    ? { x: DECALS_BENCH_BLOCK.x + opts.x, y: opts.y, z: DECALS_BENCH_BLOCK.z - BLOCK_SIZE / 2 }
    : { x: DECALS_BENCH_BLOCK.x + opts.x, y: 0, z: DECALS_BENCH_BLOCK.z + (opts.z ?? 0) };
  const where = onWall ? 'wall' : 'ground';
  const id = createMeshEntity(
    {
      geo: getDecalQuadGeometry(1, 1, 1, onWall),
      mat: current.materials[opts.mode],
      position,
      scale: onWall ? { x: width, y: depth, z: 1 } : { x: width, y: 1, z: depth },
      renderOrder: DECAL_RENDER_ORDER,
      ...NO_SHADOWS,
    },
    {
      appId: `terrainGallery_benchDecal_${where}_${opts.mode}_${opts.x}_${decalGeneration}`,
      debugData: { name: `Decal bench: ${opts.mode} on the ${where}` },
    }
  );
  current.decalIds.push(id);
};

/** The cell's size scaled to `longer` metres on its longer side */
const scaleTo = ([width, depth]: [number, number], longer: number): [number, number] => {
  const scale = longer / Math.max(width, depth);
  return [width * scale, depth * scale];
};

/**
 * The shown cell's decals: at its size and enlarged, `BLEND` and `CUTOUT`, on the ground and
 * wall. The new ones are made before the old ones go: the last mesh's ref on a registered material
 * releases it (disposed, out of the registry), and the bench keeps its materials.
 */
const createBenchDecals = (current: Bench, cell: GeneratedCell) => {
  const old = current.decalIds.splice(0);
  decalGeneration++;
  const size = cell.physicalSize;
  const enlarged = scaleTo(size, ENLARGED);
  createBenchDecal(current, { mode: 'BLEND', size, x: -4.5, z: 1.8 });
  createBenchDecal(current, { mode: 'CUTOUT', size, x: -4.5, z: 4.3 });
  createBenchDecal(current, { mode: 'BLEND', size: enlarged, x: -1.5, z: 3 });
  createBenchDecal(current, { mode: 'CUTOUT', size: enlarged, x: 2, z: 3 });
  createBenchDecal(current, { mode: 'BLEND', size, x: -3.5, y: 2.2 });
  createBenchDecal(current, { mode: 'BLEND', size: scaleTo(size, WALL_ENLARGED), x: 2.5, y: 2.2 });
  for (const id of old) deleteEntity(id);
};

/** Points the bench at a bake and its cell: the textures, the atlas's copy, the decals */
const showOnBench = (current: Bench, decal: BakedDecal, cell: GeneratedCell) => {
  for (const slot of ['albedoAlpha', 'normalRough'] as const) {
    for (const node of current.bakeNodes[slot]) node.value = decal.bake.textures[slot];
    const atlasSlot = getTexture(`${cell.atlasId}.${slot}`);
    if (atlasSlot) for (const node of current.atlasNodes[slot]) node.value = atlasSlot;
  }
  const atlasCell = getTextureAtlasInfo(getTexture(`${cell.atlasId}.albedoAlpha`) as THREE.Texture)
    ?.cells[cell.cellId];
  if (atlasCell) current.cellRect.value.fromArray(atlasCell.uv);
  createBenchDecals(current, cell);
};

/** The camera in front of the bench, above it */
const flyToBench = () =>
  flyGalleryCamera({
    pos: { x: DECALS_BENCH_BLOCK.x, y: 6, z: DECALS_BENCH_BLOCK.z + 9 },
    look: { x: DECALS_BENCH_BLOCK.x, y: 0, z: DECALS_BENCH_BLOCK.z - 1 },
  });

// --- Bakes ---

/**
 * Bakes the selected cell with the shown seed and params under a new id and shows it on the
 * bench (made with the first bake), then disposes the bake it replaces. A later call wins: an
 * earlier bake that ends after it is disposed unseen.
 */
const bakeShownAsync = async (tabId: string) => {
  const cell = getSelectedCell();
  if (!cell) return;
  const startedOn = visit;
  const thisRequest = ++request;
  let decal: BakedDecal;
  try {
    decal = await bakeDecalGenerator({
      id: `${BAKE_ID}_${bakeCount++}`,
      generator: cell.generator,
      size: cell.size,
      seed: state.seed,
      params: asParams(paramValues),
      physicalSize: cell.physicalSize,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lerror(`Decal bake failed: ${message}`, error);
    toast('alert', 'Decal bake failed', message);
    return;
  }
  if (!startedOn.isCurrent || thisRequest !== request) {
    decal.bake.dispose();
    return;
  }
  const previous = shown;
  shown = { decal, cell };
  bench ??= createBench(decal, cell);
  showOnBench(bench, decal, cell);
  // No node samples the previous bake's textures any more
  previous?.decal.bake.dispose();
  updateStatus();
  updateDebuggerTab(tabId);
};

/** A param's or the seed's change: a uniform's value and a rebake, or (a static one) a new bake */
const applyChange = (tabId: string, name: string | null, isLast: boolean) => {
  const spec = name ? shown?.cell.generator.params[name] : undefined;
  const sameCell = shown?.cell.key === state.cell;
  if (shown && sameCell && (!spec || !isStaticSpec(spec))) {
    if (name) shown.decal.setParams(asParams({ [name]: paramValues[name] }));
    else shown.decal.setSeed(state.seed);
    void shown.decal.bake.rebake();
    updateStatus();
    return;
  }
  if (isLast) void bakeShownAsync(tabId);
};

// --- Copy and export ---

const copyCellDataAsync = async () => {
  const cell = shown?.cell;
  if (!cell) return;
  const data = { ...cell.data, seed: state.seed, params: getChangedParams(cell.generator) };
  try {
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    toast(
      'info',
      `${cell.cellId}'s data copied`,
      `Paste it as the "data" of the cell "${cell.cellId}" in src/toolkit/textures/${cell.atlasId}/${cell.atlasId}.textureAtlas.json`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toast('alert', 'Copy failed', message);
  }
};

const getSourceDir = (atlasId: string) => `src/toolkit/textures/${atlasId}/source`;

/** A bake's two slots as a cell's PNGs */
const getCellOutputs = (bakeId: string, cellId: string): BakeOutputExport[] =>
  (['albedoAlpha', 'normalRough'] as const).map((output) => ({
    id: bakeId,
    output,
    fileName: `${cellId}_${output}.png`,
  }));

/** Exports the shown bake as its cell's PNGs, asking first when it isn't the cell's data */
const exportShownAsync = async () => {
  if (!shown || isExporting) return;
  const { decal, cell } = shown;
  if (
    !isCommitted(cell) &&
    !window.confirm(
      `The shown seed and params aren't ${cell.cellId}'s data in the atlas JSON, so the export won't be its recipe. Export anyway? (Copy the cell data into the atlas first.)`
    )
  ) {
    return;
  }
  isExporting = true;
  try {
    await exportBakeOutputsAsync(
      getCellOutputs(decal.bake.id, cell.cellId),
      getSourceDir(cell.atlasId)
    );
  } finally {
    isExporting = false;
  }
};

/** Bakes every generated cell of each atlas from its committed data, exports them, disposes them */
const exportAllAsync = async () => {
  if (isExporting) return;
  isExporting = true;
  try {
    const cells = getGeneratedCells();
    for (const { id: atlasId } of ATLASES) {
      const atlasCells = cells.filter((cell) => cell.atlasId === atlasId);
      const bakes = await Promise.all(
        atlasCells.map((cell) =>
          bakeDecalGenerator({
            id: `${EXPORT_ID}_${atlasId}_${cell.cellId}`,
            generator: cell.generator,
            size: cell.size,
            seed: cell.data.seed ?? 0,
            params: asParams(cell.data.params ?? {}),
            physicalSize: cell.physicalSize,
            mipmaps: false,
          })
        )
      );
      try {
        await exportBakeOutputsAsync(
          atlasCells.flatMap((cell, i) => getCellOutputs(bakes[i].bake.id, cell.cellId)),
          getSourceDir(atlasId)
        );
      } finally {
        for (const decal of bakes) decal.bake.dispose();
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lerror(`Decal export failed: ${message}`, error);
    toast('alert', 'Decal export failed', message);
  } finally {
    isExporting = false;
  }
};

// --- The tab ---

/** A field per param of the shown generator, from its spec */
const getParamItems = (tabId: string, generator: DecalGenerator): DebuggerPaneItem[] =>
  Object.entries(generator.params).map(([name, spec]): DebuggerPaneItem => {
    const base = {
      key: name,
      target: paramValues,
      label: `${spec.label ?? name}${isStaticSpec(spec) ? ' (rebakes)' : ''}`,
      onChange: (_value: unknown, change: { last?: boolean }) =>
        applyChange(tabId, name, change.last ?? true),
    };
    if (spec.type === 'color') return { ...base, kind: 'color' };
    if (spec.type === 'boolean') return { ...base, kind: 'switch' };
    if (spec.type === 'choice') {
      const options = spec.options.map((option) => ({ label: option, value: option }));
      return { ...base, kind: 'select', options };
    }
    return {
      ...base,
      ...(spec.min !== undefined ? { min: spec.min } : {}),
      ...(spec.max !== undefined ? { max: spec.max } : {}),
      step: spec.step ?? (spec.isInteger ? 1 : undefined),
    };
  });

/**
 * Starts the procedural decals' part of the tab for a visit: no bench, the first generated cell
 * selected (nothing baked until a cell is picked or the bench is shown).
 * @returns its end, for the scene's exit: later bakes are disposed unseen
 */
export const startDecalBakeTab = () => {
  const thisVisit = { isCurrent: true };
  visit = thisVisit;
  bench = null;
  shown = null;
  figures.status = '-';
  const [first] = getGeneratedCells();
  if (first) selectCell(first);
  return () => {
    thisVisit.isCurrent = false;
    bench = null;
    shown = null;
  };
};

/**
 * The procedural decals' section of the gallery's tab: the cell, the bench, the seed and params,
 * copy and export.
 * @param tabId the gallery's tab, refreshed from here
 * @returns the section
 */
export const getDecalBakeSections = (tabId: string): DebuggerTabSection[] => {
  const cells = getGeneratedCells();
  const cell = cells.find(({ key }) => key === state.cell);
  return [
    {
      pane: true,
      title: 'Procedural decals',
      id: 'terrainGalleryDecalBakes',
      content: [
        {
          key: 'cell',
          target: state,
          label: 'Cell',
          kind: 'select',
          options: cells.map((option) => ({
            label: `${option.atlasTitle}: ${option.cellId} (${option.generator.id})`,
            value: option.key,
          })),
          hint: "A generated cell of the decal atlases, baked from its generator with its data's seed and params (the atlas JSON is its recipe)",
          onChange: () => {
            const selected = getSelectedCell();
            if (selected) selectCell(selected);
            void bakeShownAsync(tabId);
            updateDebuggerTab(tabId, { rebuild: true });
          },
        },
        {
          type: 'button',
          title: 'Bake bench',
          label: 'Bake and show',
          onClick: () => {
            void bakeShownAsync(tabId);
            flyToBench();
          },
        },
        { key: 'status', target: figures, label: 'Shown', readonly: true },
        ...(cell
          ? [
              {
                key: 'seed',
                target: state,
                label: 'Seed',
                kind: 'number',
                min: 0,
                step: 1,
                onChange: () => applyChange(tabId, null, true),
              } as DebuggerPaneItem,
              ...getParamItems(tabId, cell.generator),
            ]
          : []),
        { type: 'separator' },
        {
          type: 'button',
          title: 'Atlas',
          label: 'Copy cell data',
          onClick: () => void copyCellDataAsync(),
        },
        {
          type: 'button',
          title: '',
          label: 'Export cell',
          onClick: () => void exportShownAsync(),
        },
        {
          type: 'button',
          title: '',
          label: 'Export all',
          onClick: () => void exportAllAsync(),
        },
      ],
    },
  ];
};
