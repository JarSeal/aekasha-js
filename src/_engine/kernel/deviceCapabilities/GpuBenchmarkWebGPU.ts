// The GPU benchmark's WebGPU backend (p240 §5 step 3): a device of its own on the probe's adapter,
// an offscreen RGBA8 target (no canvas: nothing is shown), the two workloads' pipelines, and each
// batch in one render pass, timed by `timestamp-query` when the adapter has it, else by the wall
// time to `onSubmittedWorkDone`. The repo has no WebGPU typings (TypeScript 5.4), so the few
// calls made are typed here, and the flags are numbers (no `GPUBufferUsage` read at load).
import type { ProbeGpuAdapter } from './DeviceProbe';
import {
  createNoiseTexels,
  FILL_ALU_ITERATIONS,
  GEOMETRY_TRIANGLE_PX,
  type GpuBenchmarkBackend,
  NOISE_TEXTURE_SIZE,
  pickBatchTiming,
  withBatchTimeoutAsync,
} from './GpuBenchmarkWorkloads';

// The WebGPU calls the backend makes. A descriptor is a plain object, checked by the browser
type WgpuBuffer = {
  mapAsync: (mode: number) => Promise<void>;
  getMappedRange: () => ArrayBuffer;
  unmap: () => void;
};
type WgpuTexture = { createView: () => unknown };
type WgpuPipeline = { getBindGroupLayout: (index: number) => unknown };
type WgpuRenderPass = {
  setPipeline: (pipeline: WgpuPipeline) => void;
  setBindGroup: (index: number, group: unknown) => void;
  draw: (vertexCount: number, instanceCount?: number) => void;
  end: () => void;
};
type WgpuCommandEncoder = {
  beginRenderPass: (descriptor: object) => WgpuRenderPass;
  resolveQuerySet: (
    querySet: unknown,
    firstQuery: number,
    queryCount: number,
    destination: WgpuBuffer,
    destinationOffset: number
  ) => void;
  copyBufferToBuffer: (
    source: WgpuBuffer,
    sourceOffset: number,
    destination: WgpuBuffer,
    destinationOffset: number,
    size: number
  ) => void;
  finish: () => unknown;
};
type WgpuDevice = {
  limits: Record<string, unknown>;
  lost: Promise<{ message?: string }>;
  queue: {
    submit: (commandBuffers: unknown[]) => void;
    writeTexture: (
      destination: object,
      data: ArrayBufferView,
      layout: object,
      size: number[]
    ) => void;
    onSubmittedWorkDone: () => Promise<void>;
  };
  createTexture: (descriptor: object) => WgpuTexture;
  createSampler: (descriptor: object) => unknown;
  createShaderModule: (descriptor: { code: string }) => unknown;
  createRenderPipelineAsync: (descriptor: object) => Promise<WgpuPipeline>;
  createBindGroup: (descriptor: object) => unknown;
  createBuffer: (descriptor: object) => WgpuBuffer;
  createQuerySet: (descriptor: object) => unknown;
  createCommandEncoder: () => WgpuCommandEncoder;
  pushErrorScope: (filter: string) => void;
  popErrorScope: () => Promise<{ message: string } | null>;
  destroy: () => void;
};

// GPUBufferUsage, GPUTextureUsage and GPUMapMode's flags
const BUFFER_MAP_READ = 0x0001;
const BUFFER_COPY_SRC = 0x0004;
const BUFFER_COPY_DST = 0x0008;
const BUFFER_QUERY_RESOLVE = 0x0200;
const TEXTURE_COPY_DST = 0x02;
const TEXTURE_BINDING = 0x04;
const TEXTURE_RENDER_ATTACHMENT = 0x10;
const MAP_MODE_READ = 0x0001;

const TARGET_FORMAT = 'rgba8unorm';

// The two workloads, as GpuBenchmarkWebGL2.ts' GLSL: keep them the same. Fill: a fullscreen
// triangle per instance, an ALU loop between two samples, blended (no early discard of hidden
// pixels on a tiler). Geometry: tiny triangles in scanline order, a cell each, wrapping over the
// target (neighbours drawn together, as a mesh's are: scattered ones measure the target's memory
// traffic instead, which grows with its size), each vertex transformed by a matrix rotated by its
// triangle's hash
const SHADER = /* wgsl */ `
@group(0) @binding(0) var noiseTexture: texture_2d<f32>;
@group(0) @binding(1) var noiseSampler: sampler;

struct FillOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex fn fillVs(@builtin(vertex_index) vertexIndex: u32) -> FillOut {
  let p = vec2f(f32((vertexIndex << 1u) & 2u), f32(vertexIndex & 2u));
  var out: FillOut;
  out.position = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  out.uv = p;
  return out;
}

@fragment fn fillFs(in: FillOut) -> @location(0) vec4f {
  var c = textureSample(noiseTexture, noiseSampler, in.uv * 4.0);
  for (var i = 0u; i < ${FILL_ALU_ITERATIONS}u; i++) {
    c = fract(c * 1.618 + c.yzwx * 0.5 + vec4f(0.1));
  }
  c += textureSample(noiseTexture, noiseSampler, c.xy);
  return vec4f(c.rgb, 0.05);
}

override PX_X: f32 = 0.002;
override PX_Y: f32 = 0.002;

fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

@vertex fn geometryVs(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
  let triangle = vertexIndex / 3u;
  let h = pcg(triangle);
  let corner = vertexIndex % 3u;
  let columns = u32(2.0 / PX_X);
  let rows = u32(2.0 / PX_Y);
  let cell = vec2f(f32(triangle % columns), f32((triangle / columns) % rows));
  let center = (cell + 0.5) * vec2f(PX_X, PX_Y) - 1.0;
  let angle = f32(h & 0xffu) * 0.0245;
  let model = mat4x4f(
    vec4f(cos(angle), sin(angle), 0.0, 0.0),
    vec4f(-sin(angle), cos(angle), 0.0, 0.0),
    vec4f(0.0, 0.0, 1.0, 0.0),
    vec4f(center, 0.5, 1.0)
  );
  return model * vec4f(select(0.0, PX_X, corner == 1u), select(0.0, PX_Y, corner == 2u), 0.0, 1.0);
}

@fragment fn geometryFs() -> @location(0) vec4f {
  return vec4f(1.0, 0.5, 0.25, 1.0);
}
`;

const BLEND = {
  color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
};

/** The fill and geometry pipelines and the fill's bind group. */
const createPipelinesAsync = async (device: WgpuDevice, width: number, height: number) => {
  const module = device.createShaderModule({ code: SHADER });
  const primitive = { topology: 'triangle-list' };
  const [fill, geometry] = await Promise.all([
    device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module, entryPoint: 'fillVs' },
      fragment: {
        module,
        entryPoint: 'fillFs',
        targets: [{ format: TARGET_FORMAT, blend: BLEND }],
      },
      primitive,
    }),
    device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'geometryVs',
        // A pixel is 2 / size in clip space
        constants: {
          PX_X: (2 * GEOMETRY_TRIANGLE_PX) / width,
          PX_Y: (2 * GEOMETRY_TRIANGLE_PX) / height,
        },
      },
      fragment: { module, entryPoint: 'geometryFs', targets: [{ format: TARGET_FORMAT }] },
      primitive,
    }),
  ]);

  const noise = device.createTexture({
    size: [NOISE_TEXTURE_SIZE, NOISE_TEXTURE_SIZE],
    format: 'rgba8unorm',
    usage: TEXTURE_BINDING | TEXTURE_COPY_DST,
  });
  device.queue.writeTexture(
    { texture: noise },
    createNoiseTexels(),
    { bytesPerRow: NOISE_TEXTURE_SIZE * 4 },
    [NOISE_TEXTURE_SIZE, NOISE_TEXTURE_SIZE]
  );
  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'repeat',
    addressModeV: 'repeat',
  });
  const fillBindGroup = device.createBindGroup({
    layout: fill.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: noise.createView() },
      { binding: 1, resource: sampler },
    ],
  });
  return { fill, geometry, fillBindGroup };
};

/** The pass's timer: a two-entry query set and its resolve and read buffers. */
const createTimer = (device: WgpuDevice) => ({
  querySet: device.createQuerySet({ type: 'timestamp', count: 2 }),
  resolveBuffer: device.createBuffer({ size: 16, usage: BUFFER_QUERY_RESOLVE | BUFFER_COPY_SRC }),
  readBuffer: device.createBuffer({ size: 16, usage: BUFFER_MAP_READ | BUFFER_COPY_DST }),
});

/**
 * Creates the WebGPU backend on `adapter`: a device (with `timestamp-query` when the adapter has
 * it), the target at `size` (clamped to the device's 2D texture limit) and the pipelines, compiled.
 * @internal
 * @returns the backend, null when the adapter can't create a device
 * @throws when the setup fails validation (the device destroyed first)
 */
export const createWebGPUBenchmarkBackendAsync = async (
  adapter: ProbeGpuAdapter,
  size: { width: number; height: number },
  now: () => number
): Promise<GpuBenchmarkBackend | null> => {
  if (!adapter.requestDevice) return null;
  const hasTimestamps = [...adapter.features].includes('timestamp-query');
  const device = (await adapter.requestDevice({
    requiredFeatures: hasTimestamps ? ['timestamp-query'] : [],
  })) as WgpuDevice;
  let lostMessage: string | null = null;
  device.lost.then((info) => (lostMessage = info.message || 'lost'));

  try {
    const maxSize = Number(device.limits.maxTextureDimension2D) || 8192;
    const width = Math.min(size.width, maxSize);
    const height = Math.min(size.height, maxSize);

    device.pushErrorScope('validation');
    const target = device.createTexture({
      size: [width, height],
      format: TARGET_FORMAT,
      usage: TEXTURE_RENDER_ATTACHMENT,
    });
    const targetView = target.createView();
    const pipelines = await createPipelinesAsync(device, width, height);
    const timer = hasTimestamps ? createTimer(device) : null;
    const setupError = await device.popErrorScope();
    if (setupError) throw new Error(`GPU benchmark (WebGPU): ${setupError.message}`);

    const runBatchAsync = async (encode: (pass: WgpuRenderPass) => void) => {
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          { view: targetView, clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store' },
        ],
        ...(timer && {
          timestampWrites: {
            querySet: timer.querySet,
            beginningOfPassWriteIndex: 0,
            endOfPassWriteIndex: 1,
          },
        }),
      });
      encode(pass);
      pass.end();
      if (timer) {
        encoder.resolveQuerySet(timer.querySet, 0, 2, timer.resolveBuffer, 0);
        encoder.copyBufferToBuffer(timer.resolveBuffer, 0, timer.readBuffer, 0, 16);
      }
      const startedAt = now();
      device.queue.submit([encoder.finish()]);
      await withBatchTimeoutAsync(device.queue.onSubmittedWorkDone(), 'a batch');
      const wallMs = now() - startedAt;
      if (lostMessage)
        throw new Error(`GPU benchmark (WebGPU): the device was lost (${lostMessage}).`);

      let queryMs: number | null = null;
      if (timer) {
        await withBatchTimeoutAsync(timer.readBuffer.mapAsync(MAP_MODE_READ), 'the timer read');
        const [begin, end] = new BigUint64Array(timer.readBuffer.getMappedRange());
        queryMs = Number(end - begin) / 1e6;
        timer.readBuffer.unmap();
      }
      return pickBatchTiming(wallMs, queryMs);
    };

    return {
      api: 'WEBGPU',
      width,
      height,
      runFillAsync: (passes) =>
        runBatchAsync((pass) => {
          pass.setPipeline(pipelines.fill);
          pass.setBindGroup(0, pipelines.fillBindGroup);
          pass.draw(3, passes);
        }),
      runGeometryAsync: (triangles) =>
        runBatchAsync((pass) => {
          pass.setPipeline(pipelines.geometry);
          pass.draw(triangles * 3);
        }),
      // Frees every resource made on it
      destroy: () => device.destroy(),
    };
  } catch (err) {
    device.destroy();
    throw err;
  }
};
