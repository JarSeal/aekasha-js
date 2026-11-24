// The GPU benchmark's WebGL2 backend (p240 §5 step 3): a throwaway context (1×1: the workloads draw
// into a renderbuffer at the target size), the two workloads in GLSL, each batch synced with a
// 1-pixel `readPixels` and timed by `EXT_disjoint_timer_query_webgl2` when the browser exposes it,
// else by the wall time to that read.
import {
  createNoiseTexels,
  FILL_ALU_ITERATIONS,
  GEOMETRY_TRIANGLE_PX,
  type GpuBenchmarkBackend,
  NOISE_TEXTURE_SIZE,
  pickBatchTiming,
} from './GpuBenchmarkWorkloads';

/** The timer query extension's constants read. */
type TimerQueryExt = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };

/** The tasks a timer query's result is waited for: it's available only after the event loop
 * turns, and the sync read has finished the batch, so one or two turns are the usual. */
const QUERY_POLL_TURNS = 20;

// The two workloads, as GpuBenchmarkWebGPU.ts' WGSL: keep them the same
const FILL_VS = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FILL_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D noiseTexture;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec4 c = texture(noiseTexture, vUv * 4.0);
  for (int i = 0; i < ${FILL_ALU_ITERATIONS}; i++) {
    c = fract(c * 1.618 + c.yzwx * 0.5 + vec4(0.1));
  }
  c += texture(noiseTexture, c.xy);
  outColor = vec4(c.rgb, 0.05);
}`;

const GEOMETRY_VS = /* glsl */ `#version 300 es
uniform vec2 px;
uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
void main() {
  uint vertexIndex = uint(gl_VertexID);
  uint triangle = vertexIndex / 3u;
  uint h = pcg(triangle);
  uint corner = vertexIndex % 3u;
  uint columns = uint(2.0 / px.x);
  uint rows = uint(2.0 / px.y);
  vec2 cell = vec2(float(triangle % columns), float((triangle / columns) % rows));
  vec2 center = (cell + 0.5) * px - 1.0;
  float angle = float(h & 0xffu) * 0.0245;
  mat4 model = mat4(
    cos(angle), sin(angle), 0.0, 0.0,
    -sin(angle), cos(angle), 0.0, 0.0,
    0.0, 0.0, 1.0, 0.0,
    center, 0.5, 1.0
  );
  gl_Position = model * vec4(corner == 1u ? px.x : 0.0, corner == 2u ? px.y : 0.0, 0.0, 1.0);
}`;

const GEOMETRY_FS = /* glsl */ `#version 300 es
precision highp float;
out vec4 outColor;
void main() {
  outColor = vec4(1.0, 0.5, 0.25, 1.0);
}`;

/** A linked program of the two shaders. */
const createProgram = (gl: WebGL2RenderingContext, vsSource: string, fsSource: string) => {
  const program = gl.createProgram();
  if (!program) throw new Error('GPU benchmark (WebGL2): no program.');
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vsSource],
    [gl.FRAGMENT_SHADER, fsSource],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('GPU benchmark (WebGL2): no shader.');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`GPU benchmark (WebGL2): ${gl.getProgramInfoLog(program) ?? 'link failed'}`);
  }
  return program;
};

/** The render target: an RGBA8 renderbuffer in a framebuffer, bound. */
const createTarget = (gl: WebGL2RenderingContext, width: number, height: number) => {
  const renderbuffer = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, width, height);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, renderbuffer);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('GPU benchmark (WebGL2): the render target is incomplete.');
  }
  gl.viewport(0, 0, width, height);
};

/** The fill shader's texture, bound to unit 0. */
const createNoiseTexture = (gl: WebGL2RenderingContext) => {
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    NOISE_TEXTURE_SIZE,
    NOISE_TEXTURE_SIZE,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    createNoiseTexels()
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
};

/** A timer query's result, ms, once the event loop has turned enough for it to be available;
 * null when it never is or the GPU's timer was disjoint meanwhile (the reading is invalid). */
const readTimerQueryMsAsync = async (
  gl: WebGL2RenderingContext,
  ext: TimerQueryExt,
  query: WebGLQuery
) => {
  for (let turn = 0; turn < QUERY_POLL_TURNS; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) continue;
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) return null;
    return Number(gl.getQueryParameter(query, gl.QUERY_RESULT)) / 1e6;
  }
  return null;
};

/**
 * Creates the WebGL2 backend: a high-performance context, the target at `size` (clamped to the
 * renderbuffer limit) and the programs, linked.
 * @internal
 * @returns the backend, null without a WebGL2 context
 * @throws when a program or the target fails (the context lost first)
 */
export const createWebGL2BenchmarkBackend = (
  createContext: ((attributes?: WebGLContextAttributes) => WebGL2RenderingContext | null) | null,
  size: { width: number; height: number },
  now: () => number
): GpuBenchmarkBackend | null => {
  const gl =
    createContext?.({
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    }) ?? null;
  if (!gl) return null;
  const loseContext = () => gl.getExtension('WEBGL_lose_context')?.loseContext();

  try {
    const maxSize = Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)) || 4096;
    const width = Math.min(size.width, maxSize);
    const height = Math.min(size.height, maxSize);
    createTarget(gl, width, height);
    createNoiseTexture(gl);
    gl.bindVertexArray(gl.createVertexArray());

    const fill = createProgram(gl, FILL_VS, FILL_FS);
    gl.useProgram(fill);
    gl.uniform1i(gl.getUniformLocation(fill, 'noiseTexture'), 0);
    const geometry = createProgram(gl, GEOMETRY_VS, GEOMETRY_FS);
    gl.useProgram(geometry);
    // A pixel is 2 / size in clip space
    gl.uniform2f(
      gl.getUniformLocation(geometry, 'px'),
      (2 * GEOMETRY_TRIANGLE_PX) / width,
      (2 * GEOMETRY_TRIANGLE_PX) / height
    );
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 1);

    const timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQueryExt | null;
    const pixel = new Uint8Array(4);

    const runBatchAsync = async (draw: () => void) => {
      const query = timerExt ? gl.createQuery() : null;
      const startedAt = now();
      if (timerExt && query) gl.beginQuery(timerExt.TIME_ELAPSED_EXT, query);
      gl.clear(gl.COLOR_BUFFER_BIT);
      draw();
      if (timerExt && query) gl.endQuery(timerExt.TIME_ELAPSED_EXT);
      // Waits for the batch: the read needs every draw before it done
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      const wallMs = now() - startedAt;
      if (gl.isContextLost()) throw new Error('GPU benchmark (WebGL2): the context was lost.');

      let queryMs: number | null = null;
      if (timerExt && query) {
        queryMs = await readTimerQueryMsAsync(gl, timerExt, query);
        gl.deleteQuery(query);
      }
      return pickBatchTiming(wallMs, queryMs);
    };

    return {
      api: 'WEBGL2',
      width,
      height,
      runFillAsync: (passes) =>
        runBatchAsync(() => {
          gl.useProgram(fill);
          gl.enable(gl.BLEND);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, passes);
        }),
      runGeometryAsync: (triangles) =>
        runBatchAsync(() => {
          gl.useProgram(geometry);
          gl.disable(gl.BLEND);
          gl.drawArrays(gl.TRIANGLES, 0, triangles * 3);
        }),
      // Losing the context frees everything made on it
      destroy: loseContext,
    };
  } catch (err) {
    loseContext();
    throw err;
  }
};
