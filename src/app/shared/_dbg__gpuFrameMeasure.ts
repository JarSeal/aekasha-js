// The frame GPU measurement two terrain scenes share (p310 §2.3; the terrain gallery's measurement
// mode and the terrain showcase's weather measurement): the sampler (the mean GPU ms of
// `SAMPLE_FRAMES` frames after `WARM_UP_FRAMES` from the engine's frame record, `onGpuFrameTime`,
// and the mean draw calls of the frames meanwhile, read in `LATE_MAIN`, after the render), the
// conditions every measurement sets (the pixel ratio 1, the day-night cycle paused) and a table's
// heading naming the machine, the canvas and what's off, with a warning when the canvas isn't
// 1920 × 1080. The figures are WebGPU's: on WebGL2 three's timer pool times one context at a time
// and loses the queries opened while a resolve polls (about two frames in three get a figure).
import {
  ECSSystemStage,
  getECSWorld,
  getMeshByAppId,
  getRenderer,
  isWebGPURenderer,
} from 'aekasha';
import { addDebugToast, onGpuFrameTime } from 'aekasha/debug';
import { isDayNightPlaying, pauseDayNight, playDayNight } from 'aekasha/skybox';

/** The frames a sample lets pass (a variant's compile, the step before), then averages */
export const WARM_UP_FRAMES = 30;
export const SAMPLE_FRAMES = 120;
/** How long a sample waits for its first frame time, and for all of them, ms */
const FIRST_FRAME_TIMEOUT_MS = 4000;
const SAMPLE_TIMEOUT_MS = 30000;
/** The canvas the tables are measured on */
export const TABLE_CANVAS = { width: 1920, height: 1080 };

/** The draw counter's system, removed when its sample ends */
const DRAWS_SYSTEM_ID = 'gpuFrameMeasureDraws';

/** A sample: the frame's mean GPU ms and its mean draw calls (every pass: shadows, the sky) */
export type FrameSample = { gpuMs: number; draws: number };

/**
 * The mean GPU ms of `SAMPLE_FRAMES` frames after `WARM_UP_FRAMES` and the mean draw calls of the
 * frames rendered after the warm-up meanwhile (the GPU times arrive frames late, so the two
 * windows overlap rather than match: alike while nothing changes), or null when no frame time
 * comes (no timer queries, a paused loop). One sample at a time.
 */
export const sampleFrameAsync = () =>
  new Promise<FrameSample | null>((resolve) => {
    const world = getECSWorld();
    let seen = 0;
    let sum = 0;
    let drawFrames = 0;
    let drawSum = 0;
    const end = (gpuMs: number | null) => {
      clearTimeout(firstFrameTimer);
      clearTimeout(sampleTimer);
      stop();
      world.removeSystem(DRAWS_SYSTEM_ID);
      resolve(gpuMs === null ? null : { gpuMs, draws: drawFrames ? drawSum / drawFrames : 0 });
    };
    world.addSystem(ECSSystemStage.LATE_MAIN, DRAWS_SYSTEM_ID, () => {
      if (seen <= WARM_UP_FRAMES) return;
      drawSum += getRenderer()?.info.render.drawCalls ?? 0;
      drawFrames++;
    });
    const stop = onGpuFrameTime((gpuMs) => {
      if (seen++ === 0) clearTimeout(firstFrameTimer);
      if (seen <= WARM_UP_FRAMES) return;
      sum += gpuMs;
      if (seen === WARM_UP_FRAMES + SAMPLE_FRAMES) end(sum / SAMPLE_FRAMES);
    });
    const firstFrameTimer = setTimeout(() => end(null), FIRST_FRAME_TIMEOUT_MS);
    const sampleTimer = setTimeout(() => end(null), SAMPLE_TIMEOUT_MS);
  });

/**
 * The mean GPU ms of `SAMPLE_FRAMES` frames after `WARM_UP_FRAMES` (`sampleFrameAsync`'s), or
 * null when no frame time comes: the measurements that don't count draws
 */
export const sampleFrameGpuMsAsync = async () => (await sampleFrameAsync())?.gpuMs ?? null;

/** Hides the meshes of the app ids and returns the function that shows those it hid again */
export const hideMeshes = (appIds: string[]) => {
  const hidden = appIds.flatMap((appId) => {
    const mesh = getMeshByAppId(appId);
    if (!mesh?.visible) return [];
    mesh.visible = false;
    return [mesh];
  });
  return () => {
    for (const mesh of hidden) mesh.visible = true;
  };
};

/**
 * Sets the conditions every measurement shares: the pixel ratio 1 and the day-night cycle paused
 * @returns the function that puts both back
 */
export const startMeasureConditions = () => {
  const renderer = getRenderer();
  const pixelRatio = renderer?.getPixelRatio() ?? 1;
  renderer?.setPixelRatio(1);
  const wasPlaying = isDayNightPlaying();
  if (wasPlaying) pauseDayNight();
  return () => {
    renderer?.setPixelRatio(pixelRatio);
    if (wasPlaying) playDayNight();
  };
};

// The WebGPU device and the WebGL context of three's backends (not in three's types; the About
// dialog's reading)
type BackendInternals = {
  device?: { adapterInfo?: { vendor?: string; architecture?: string; description?: string } };
  gl?: WebGL2RenderingContext;
};

/** The GPU as the browser names it */
const getGpuText = () => {
  const backend = getRenderer()?.backend as unknown as BackendInternals | undefined;
  const info = backend?.device?.adapterInfo;
  const text = info
    ? [info.vendor, info.architecture, info.description].filter(Boolean).join(' ')
    : '';
  if (text) return text;
  const gl = backend?.gl;
  if (!gl) return 'GPU not reported';
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
};

/** The browser's full version, where the user agent's is reduced (Chromium's `157.0.0.0`): read
 * once by `readBrowserVersionAsync` */
let fullBrowserText: string | null = null;

/** Reads Chromium's full version from its client hints (none elsewhere), for the headings */
export const readBrowserVersionAsync = async () => {
  const data = (
    navigator as {
      userAgentData?: {
        getHighEntropyValues: (hints: string[]) => Promise<{
          fullVersionList?: { brand: string; version: string }[];
        }>;
      };
    }
  ).userAgentData;
  if (!data) return;
  try {
    const { fullVersionList } = await data.getHighEntropyValues(['fullVersionList']);
    const brand = fullVersionList?.find(({ brand }) => /Chrome|Edge/.test(brand));
    if (brand) fullBrowserText = `${brand.brand.replace('Google ', '')} ${brand.version}`;
  } catch {
    // The user agent's own version stays
  }
};

/** The browser and its version: the full one when read, else the user agent's */
const getBrowserText = () => {
  if (fullBrowserText) return fullBrowserText;
  const ua = navigator.userAgent;
  const match = /(Edg|Firefox|Chrome|Safari)\/([\d.]+)/.exec(ua);
  const name = match ? { Edg: 'Edge' }[match[1]] ?? match[1] : 'a browser';
  return match ? `${name} ${match[2]}` : name;
};

/** Whether the canvas is the tables' size (at the pixel ratio 1 the measurement sets) */
const isTableCanvas = () => {
  const canvas = getRenderer()?.domElement;
  return canvas?.width === TABLE_CANVAS.width && canvas?.height === TABLE_CANVAS.height;
};

/**
 * A measurement table's heading: what was measured, the backend, the GPU, the browser, the canvas
 * and the conditions; a warning line when the canvas isn't the tables'
 * @param subject what each figure is of ("a block alone")
 * @param conditions what's on and off in the frame (default the terrain gallery's)
 * @returns the heading's lines
 */
export const getMeasureHeading = (
  subject: string,
  conditions = 'no PostFX, no shadows, the sky still'
) => {
  const canvas = getRenderer()?.domElement;
  const backend = isWebGPURenderer() ? 'WebGPU' : 'WebGL2';
  const lines = [
    `Frame GPU ms, ${subject}: ${backend}, ${getGpuText()}, ${getBrowserText()}; a ${canvas?.width} × ${canvas?.height} px canvas at a pixel ratio of 1; ${conditions}; the mean of ${SAMPLE_FRAMES} frames after ${WARM_UP_FRAMES}.`,
  ];
  if (!isTableCanvas()) {
    lines.push(
      '',
      `Not the tables' ${TABLE_CANVAS.width} × ${TABLE_CANVAS.height} canvas: comparable only with this table.`
    );
  }
  return lines;
};

/** The no-figures toast: no timer queries, or no frames */
export const warnNoFrameTimes = () =>
  addDebugToast({
    type: 'warning',
    title: 'No GPU frame times',
    message:
      'The measurement needs GPU timer queries (WebGPU with timestamp-query) and a running main loop.',
    showingTime: 10000,
  });

/** Copies a table to the clipboard (not awaited: a page without the focus may never settle it) */
export const copyTable = (table: string) => {
  void navigator.clipboard?.writeText(table).catch(() => undefined);
};
