import * as THREE from 'three/webgpu';
import { getRenderer, llog, lwarn } from 'aekasha';
import { addDebugToast } from 'aekasha/debug';
import type { DebuggerListItem } from 'aekasha/debug';
import { getBackendName, getCountedGpuBytes, nextFrames } from '../../shared/verifyHarness';
import {
  COMPARE_VARIANTS,
  compareConfig,
  getCompareSlots,
  rebuildCompareSlot,
  showCompareSlot,
  type CompareSlot,
  type CompareVariant,
} from './assetCompare';
import {
  findReportModelBytes,
  findReportTexture,
  formatBytes,
  loadReportAsync,
  refreshAssetCompareTab,
} from './_dbg__assetCompareReport';

// "Measure all variants": builds every variant in slot B, shows it until all its textures were
// drawn, and records what this device made of them (the GPU format the KTX2 files were transcoded
// to, three's VRAM figure, the build time). The same run on WebGL2, desktop WebGPU and phones
// compares the devices: "Copy results" puts the JSON on the clipboard.

type MeasuredTexture = {
  subject: string;
  name: string;
  file: string;
  /** The three format constant the texture was uploaded as (eg. `RGBA_BPTC_Format`). */
  format: string;
  width: number;
  height: number;
  fileBytes?: number;
  vramBytes?: number;
  rgba8Bytes?: number;
};

type MeasuredVariant = {
  variant: string;
  normalMode: boolean;
  /** Load, transcode and import (rebuildCompareSlot), until the slot was built. */
  buildMs: number;
  /** Until every texture was drawn (shader compile and upload included). */
  firstDrawMs: number | null;
  textureFileBytes: number;
  propFileBytes?: number;
  vramBytes: number;
  textures: MeasuredTexture[];
  messages: string[];
};

type MeasureResults = {
  measuredAt: string;
  backend: string;
  adapter: string;
  userAgent: string;
  devicePixelRatio: number;
  variants: MeasuredVariant[];
};

/** Waits until every texture was drawn (in `renderer.info.memoryMap`), or the timeout. */
const MEASURE_DRAW_TIMEOUT_MS = 30000;

let measureResults: MeasureResults | null = null;
let measureProgress: string | null = null;

export const isMeasuring = () => Boolean(measureProgress);
export const hasMeasureResults = () => Boolean(measureResults);

let formatNames: Map<number, string> | null = null;

/** The name of three's format constant, eg. `RGBA_ASTC_4x4_Format` */
const getFormatName = (format: number) => {
  if (!formatNames) {
    formatNames = new Map();
    for (const [key, value] of Object.entries(THREE)) {
      if (key.endsWith('Format') && typeof value === 'number' && !formatNames.has(value)) {
        formatNames.set(value, key);
      }
    }
  }
  return formatNames.get(format) ?? String(format);
};

/** The GPU's name, from the backend's adapter info or WebGL's debug renderer info */
const getAdapterName = () => {
  // Not in three's types: the backends' device and context
  const backend = getRenderer()?.backend as unknown as {
    device?: { adapterInfo?: Record<string, string> };
    gl?: WebGL2RenderingContext;
  };
  const info = backend?.device?.adapterInfo;
  if (info) {
    return [info.vendor, info.architecture, info.device, info.description]
      .filter(Boolean)
      .join(' / ');
  }
  const gl = backend?.gl;
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  return gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
};

const measureSlot = (slot: CompareSlot): MeasuredTexture[] =>
  slot.textures.map((t) => {
    const entry = findReportTexture(t);
    const image = t.texture.image as { width?: number; height?: number } | undefined;
    return {
      subject: t.subject,
      name: t.name,
      file: t.file,
      format: getFormatName(t.texture.format),
      width: image?.width ?? 0,
      height: image?.height ?? 0,
      fileBytes: t.reportKind ? undefined : entry?.bytes,
      vramBytes: getCountedGpuBytes(t.texture),
      rgba8Bytes: entry?.vramBytes.rgba8,
    };
  });

/** Builds one variant in the slot and waits for its first draw: its measurement, or null when
 * the scene was left */
const measureVariantAsync = async (
  slot: CompareSlot,
  run: { variant: CompareVariant; normalMode: boolean }
): Promise<MeasuredVariant | null> => {
  compareConfig.variantB = run.variant;
  compareConfig.normalModeB = run.normalMode;
  const start = performance.now();
  await rebuildCompareSlot('B');
  if (slot.isLeft) return null;
  const buildMs = performance.now() - start;
  showCompareSlot('B');
  let firstDrawMs: number | null = null;
  while (performance.now() - start < MEASURE_DRAW_TIMEOUT_MS) {
    await nextFrames();
    if (slot.isLeft) return null;
    if (slot.textures.every((t) => getCountedGpuBytes(t.texture) !== undefined)) {
      firstDrawMs = performance.now() - start;
      break;
    }
  }
  const textures = measureSlot(slot);
  return {
    variant: run.variant,
    normalMode: run.normalMode,
    buildMs: Math.round(buildMs),
    firstDrawMs: firstDrawMs === null ? null : Math.round(firstDrawMs),
    textureFileBytes: textures.reduce((sum, t) => sum + (t.fileBytes ?? 0), 0),
    propFileBytes: findReportModelBytes(slot.propFile),
    vramBytes: textures.reduce((sum, t) => sum + (t.vramBytes ?? 0), 0),
    textures,
    messages: [...slot.messages, ...(firstDrawMs === null ? ['not all textures drawn'] : [])],
  };
};

/** Every variant in slot B, one after another; slot B's settings and the shown slot are restored
 * at the end. Returns the results (also kept for the tab and "Copy results"), or null when the
 * scene was left during the run, which stops it. */
export const measureAllVariants = async () => {
  if (measureProgress) return measureResults;
  const slot = getCompareSlots().B;
  await loadReportAsync();
  if (slot.isLeft) return null;
  const saved = {
    variantB: compareConfig.variantB,
    normalModeB: compareConfig.normalModeB,
    shown: compareConfig.shown,
  };
  const runs = COMPARE_VARIANTS.flatMap(
    (variant): { variant: CompareVariant; normalMode: boolean }[] =>
      variant === 'png'
        ? [{ variant, normalMode: false }]
        : [false, true].map((normalMode) => ({ variant, normalMode }))
  );
  const results: MeasureResults = {
    measuredAt: new Date().toISOString(),
    backend: getBackendName(),
    adapter: getAdapterName(),
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    variants: [],
  };
  try {
    for (const [i, run] of runs.entries()) {
      measureProgress = `${i + 1} / ${runs.length}: ${run.variant}${run.normalMode ? ' (normal mode)' : ''}`;
      const measured = await measureVariantAsync(slot, run);
      if (!measured) break;
      results.variants.push(measured);
    }
  } finally {
    measureProgress = null;
    Object.assign(compareConfig, { variantB: saved.variantB, normalModeB: saved.normalModeB });
    if (slot.isLeft) {
      compareConfig.shown = saved.shown;
    } else {
      await rebuildCompareSlot('B');
      showCompareSlot(saved.shown);
    }
  }
  if (slot.isLeft) return null;
  measureResults = results;
  llog('[assetCompare] Measured all variants', results);
  refreshAssetCompareTab();
  return results;
};

/** Puts the last results on the clipboard as JSON */
export const copyMeasureResultsAsync = async () => {
  if (!measureResults) return;
  try {
    // A button click (user activation): Safari refuses the clipboard after the async run itself
    await navigator.clipboard.writeText(JSON.stringify(measureResults, null, 2));
    addDebugToast({ title: 'Results copied' });
  } catch (error) {
    lwarn('[assetCompare] Could not copy the results (they are also in the console)', error);
  }
};

/** The measure's list rows: the device, then one per variant */
export const getMeasureRows = (): DebuggerListItem[] => {
  if (measureProgress) {
    return [{ itemId: 'progress', title: `Measuring ${measureProgress}…`, titlePlaceholder: true }];
  }
  if (!measureResults) return [];
  const { backend, adapter, variants } = measureResults;
  return [
    { itemId: 'device', title: backend, subTitle: adapter },
    ...variants.map((v, i): DebuggerListItem => {
      const formats = [...new Set(v.textures.map((t) => t.format.replace(/_?Format$/, '')))];
      return {
        itemId: `variant${i}`,
        title: `${v.variant}${v.normalMode ? ' (nm)' : ''}`,
        badge: v.messages.length ? '!' : undefined,
        suffix: formatBytes(v.vramBytes),
        description: [
          `files ${formatBytes(v.textureFileBytes)}${v.propFileBytes ? ` + GLB ${formatBytes(v.propFileBytes)}` : ''}`,
          `build ${v.buildMs} ms, drawn ${v.firstDrawMs ?? '—'} ms`,
          formats.join(', '),
          ...v.messages,
        ].join(' · '),
      };
    }),
  ];
};
