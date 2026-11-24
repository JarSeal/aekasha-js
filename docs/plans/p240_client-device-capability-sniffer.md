Status: in progress | Phases 1-3 implemented
Category: Performance, Settings
Related: the PostFX feature (`aekasha/postfx`, `features/postfx/PostFX.ts`: `setPostFxEnabled` is one of the switches the recommendations target), the LOD feature (`src/_engine/features/lod/CLAUDE.md`, p350: the device levels are a natural LOD budget input, eg. `setLodBias`, `setLodMaxSelectionsPerFrame`), the profiler's GPU memory tab (`src/_engine/debug/CLAUDE.md`; p345 §2.4: a device memory level is its natural default budget, see Phase 3), the physics transform buffer (`features/physics/CLAUDE.md`: a `SharedArrayBuffer` only when the page is cross-origin-isolated, so `crossOriginIsolated` is part of the probe), the sky box (`features/skybox/SkyLights.ts`: its sun light's `shadowPreset` uses the same `LOW`…`ULTRA` scale as the device levels, see §3.1)

# Client Device Capability Sniffer — Plan

Measure what the client device can do, once, and hand the result to the app so it can choose (or disable) settings before and during play. The result has three layers:

1. **Measurements**: what the browser exposes (WebGPU adapter info, features and limits, WebGL2 fallback caps, cores, memory hints, display) plus a short synthetic GPU and CPU benchmark.
2. **Verdict**: the measurements checked against **targets** (FPS, memory, GPU memory, cores, required features). Every target has an engine default and can be overridden in `CONFIG.ts` or per call.
3. **Levels and recommendations**: a device level (`LOW | MEDIUM | HIGH | ULTRA`, the same scale as the shadow presets) per category (GPU, CPU, memory, GPU memory) plus an overall level (§3.1), and suggested values (pixel ratio, antialias, shadow quality, PostFX, backend, physics worker target). They are advisory data. The engine applies nothing on its own (see §1.3).

It is opt-in at engine init (`AppConfig.deviceCapabilities.runAtInit`, default `false`) and always callable from app code (eg. a "Re-test my device" button in a game settings menu: the UI kit's `createSettingsMenu`, `ui/game/SettingsMenu.ts`). With `saveToLS` (default `true`) the measurements are stored in localStorage and later boots skip the test while the stored result is still valid (§4).

Code-level name: `DeviceCapabilities` (the plan name keeps "sniffer"; in web terms "sniffing" usually means user-agent string guessing, which is only a small fallback here).

All phases are non-breaking: with `runAtInit` off and nobody calling the API, nothing runs and the benchmark code is never downloaded (the Smallest Build Possible rule: the heavy parts load on first use, and `yarn sbp` shows none of it in the first download).

**Where it lives:** a kernel area, `src/_engine/kernel/deviceCapabilities/` (the kernel's layout rule covers a new `kernel/<area>/`; the root `CLAUDE.md`'s kernel list gets it), its API on the `aekasha` entry. Not an opt-in feature (`EngineFeature`): `runAtInit` runs before the kernel and the features install (§5), and nothing of it runs or downloads unless asked, which is what a feature's opt-in would buy.

---

## 1. Scope decisions

### 1.1 What can and cannot be measured (read this first)

| Target | Source | Availability | Result when unavailable |
| --- | --- | --- | --- |
| FPS | Synthetic GPU benchmark → estimated frame time for a reference frame at the target resolution; display refresh rate via rAF | All browsers with WebGPU or WebGL2 | never unavailable, but it is an **estimate** (§1.2) |
| System memory | `navigator.deviceMemory` | Chromium only, bucketed (0.25…8), capped at 8 GB | `UNKNOWN` |
| JS heap limit | `performance.memory.jsHeapSizeLimit` | Chromium only, non-standard | `UNKNOWN` |
| GPU memory (VRAM) | **No web API exposes it.** Heuristic only: unified memory (Apple silicon, from adapter info) → a share of `deviceMemory`; integrated GPU → a smaller share; discrete → unknown | Heuristic, low confidence | `UNKNOWN` (common) |
| CPU cores | `navigator.hardwareConcurrency` | All (Safari may clamp) | — |
| CPU speed | Short main-thread micro-benchmark | All | — |
| WebGPU features/limits | `GPUAdapter.features` / `.limits` / `.info` | WebGPU browsers (`info` is coarse or empty on some) | fields `null` |

Each target check returns `'PASS' | 'FAIL' | 'UNKNOWN'`. `targets.unknownIs` (`'PASS' | 'FAIL'`, default `'PASS'`) decides how `UNKNOWN` counts toward `meetsTargets`. Otherwise a Firefox or Safari user would fail every memory target just because the browser doesn't say.

**Not done:** probing VRAM by allocating textures until failure. That can lose the device, crash the tab or push the OS into swap.

### 1.2 FPS is predicted, not observed

`requestAnimationFrame` is capped at the display refresh rate, so timing rAF frames only tells us "at least 60" (or 120, 144…). The benchmark instead measures **GPU throughput** (fill rate × shader cost, triangles) with vsync out of the picture. It then predicts the frame time of a configurable **reference frame** (`targets.referenceFrame`) at the target resolution. That is a proxy for the app's real scenes. Defaults are calibrated against the example app (Phase 2 task) and apps should tune them. Phase 4 adds the real check: it samples actual frame times once a scene is running.

The effective FPS target is `min(targets.fps, measuredRefreshHz)`. A 60 Hz display can never "fail" a 120 FPS target. The report shows both numbers.

### 1.3 Advisory, not applied

The engine has no graphics settings system yet (`createRenderer` options are set once by the app, and a light's `shadowPreset` (`ShadowQuality`, `SHADOW_PRESETS` in `kernel/light/Light.ts`) is chosen per light). This plan therefore stops at data. The app reads `report.recommendations` and passes them where it wants, eg. `createRenderer({ devicePixelRatio: rec.pixelRatio, antialias: rec.antialias })` in `InitEngine`'s `start`. A future "graphics settings" plan can consume the same report to apply settings automatically.

`recommendations.physicsWorkerTarget` is the exception in timing: `AppConfig.physics.workerTarget` is read at `physics()`'s install, which comes after a `runAtInit` check but takes the config the app already passed, so the app applies it on the next boot (eg. from the stored report, read before `InitEngine`).

### 1.4 Benchmark on raw WebGPU / WebGL2, not three.js

The benchmark creates its own short-lived GPU device (WebGPU) or context (WebGL2) on a small offscreen canvas and destroys it afterwards. Why not three.js:

- It runs at engine init, **before** `createRenderer` (the app creates the renderer in `InitEngine`'s `start`), so its result can shape the renderer options.
- A second `WebGPURenderer` would cost TSL node compilation (often seconds on a first compile) and a second full renderer.
- Raw pipelines with fixed WGSL/GLSL shaders measure throughput in milliseconds and give numbers that are comparable across runs.

The trade-off (synthetic ≠ the app's scene) is what §1.2 and Phase 4 address.

---

## 2. Config

New optional block in `AppConfig` (`src/_engine/kernel/config/Config.ts`), with its defaults where `loadConfig` fills the others':

```ts
deviceCapabilities?: {
  /** Run the check in InitEngine, before the app's `start`. Default false (opt-in). */
  runAtInit?: boolean;
  /** Store the measurements in localStorage and reuse them on later boots. Default true. */
  saveToLS?: boolean;
  /** Days before a stored result is measured again. 0 = never expires. Default 30. */
  maxAgeDays?: number;
  benchmark?: {
    /** Run the GPU/CPU benchmark (false = static probe only; GPU and CPU levels from heuristics). Default true. */
    enabled?: boolean;
    /** Upper bound (ms) for the whole benchmark. Default 1500. */
    budgetMs?: number;
  };
  targets?: DeviceCapabilityTargets;
  /** Per-category level thresholds (§3.1), deep-merged over the engine defaults. */
  levelThresholds?: DeviceLevelThresholds;
};

type DeviceCapabilityTargets = {
  fps?: number;                       // default 60
  /** 'CANVAS' = current window size × devicePixelRatio. Default 'CANVAS'. */
  resolution?: 'CANVAS' | { width: number; height: number };
  referenceFrame?: {
    fullscreenPasses?: number;        // default 6 (scene + shadow + PostFX-ish overdraw)
    trianglesPerFrame?: number;       // default 1_000_000
  };
  minDeviceMemoryGB?: number;         // default 4
  minGPUMemoryMB?: number;            // default 2048
  minCpuCores?: number;               // default 4
  requireWebGPU?: boolean;            // default false
  requiredGPUFeatures?: GPUFeatureName[]; // default []
  /** Minimum device levels (§3.1), eg. { overall: 'MEDIUM', gpu: 'HIGH' }. Default {}. */
  minLevels?: Partial<Record<DeviceLevelCategory | 'overall', QualityLevel>>;
  unknownIs?: 'PASS' | 'FAIL';        // default 'PASS'
};
```

Targets are deep-merged: engine defaults ← `CONFIG.ts` ← per-call `targets`.

---

## 3. Public API (`src/_engine/kernel/deviceCapabilities/DeviceCapabilities.ts`, on `aekasha`)

```ts
runDeviceCapabilityCheck(opts?: {
  force?: boolean;          // ignore a valid stored result and measure again
  saveToLS?: boolean;       // default: config value
  benchmark?: boolean;      // default: config value
  targets?: DeviceCapabilityTargets;
  pauseMainLoop?: boolean;  // default true; only matters when the loop is running (§5)
  onProgress?: (phase: 'PROBE' | 'GPU' | 'CPU' | 'DONE', progress01: number) => void;
}): Promise<DeviceCapabilityReport>;

getDeviceCapabilityReport(): DeviceCapabilityReport | null;  // last result (init, LS or a call)
evaluateDeviceCapabilities(targets: DeviceCapabilityTargets): DeviceCapabilityVerdict; // re-score, no re-measure
clearStoredDeviceCapabilityReport(): void;
addDeviceCapabilityListener(fn: (report) => void): () => void; // returns unsubscribe
```

- Concurrent calls share one in-flight promise.
- Naming and docs as the coding standards say: `addDeviceCapabilityListener` returns its remover (an `on*` name, `onDeviceCapabilityReport`, is the standards' form; pick one in Phase 1), every export has its JSDoc and the entry APIs an `@example`.
- `evaluateDeviceCapabilities` lets a settings menu answer "what would ULTRA need / does this device meet the 'High' preset's targets" without running anything.

Report shape (`kernel/deviceCapabilities/DeviceCapabilitiesTypes.ts`):

```ts
type DeviceCapabilityReport = {
  reportVersion: number;             // bumped when measuring changes → stored results re-measure
  measuredAt: number;                // epoch ms
  fromCache: boolean;
  measurements: {
    gpu: { api: 'WEBGPU' | 'WEBGL2' | 'NONE'; vendor; architecture; device; description;
           isFallbackAdapter; isUnifiedMemory: boolean | null; isIntegrated: boolean | null;
           features: string[]; limits: Record<string, number>; preferredCanvasFormat? ;
           webgl2?: { maxTextureSize; maxSamples; extensions: string[]; unmaskedRenderer? } };
    gpuMemoryMB: { value: number | null; source: 'HEURISTIC_UNIFIED' | 'HEURISTIC_INTEGRATED' | 'UNKNOWN' };
    memory: { deviceMemoryGB: number | null; jsHeapLimitMB: number | null };
    cpu: { cores: number | null; benchScore: number | null };
    display: { width; height; devicePixelRatio; refreshHz: number | null; hdr: boolean; wideGamut: boolean };
    env: { crossOriginIsolated: boolean; offscreenCanvas: boolean; isMobile: boolean | null; coarsePointer: boolean };
    benchmark: { fillRateMPixOpsPerMs: number; trianglesPerMs: number; usedTimestampQuery: boolean; durationMs: number } | null;
  };
  verdict: DeviceCapabilityVerdict;  // recomputed from measurements + current targets, never stored
};

type DeviceCapabilityVerdict = {
  targets: Required<DeviceCapabilityTargets>;
  checks: Record<'fps' | 'deviceMemory' | 'gpuMemory' | 'cpuCores' | 'webgpu' | 'gpuFeatures' | 'minLevels',
                 { result: 'PASS' | 'FAIL' | 'UNKNOWN'; measured: number | boolean | string | null; required: number | boolean | string }>;
  estimatedFps: number | null;       // at target resolution, reference frame
  effectiveFpsTarget: number;        // min(targets.fps, refreshHz)
  meetsTargets: boolean;
  failedTargets: string[];
  levels: DeviceLevels;              // §3.1
  scores: { gpu: number | null; cpu: number | null; memory: number | null; gpuMemory: number | null }; // 0..100, null = UNKNOWN
  recommendations: {
    pixelRatio: number;              // largest DPR ≤ window.devicePixelRatio whose estimated FPS meets the target
    antialias: boolean;
    shadowQuality: QualityLevel;     // a SHADOW_PRESETS key (§3.1)
    postFx: boolean;
    renderBackend: 'WEBGPU' | 'WEBGL2';
    physicsWorkerTarget: PhysicsWorkerTarget;
  };
};
```

### 3.1 Device levels

**One scale.** Device levels use the same `LOW | MEDIUM | HIGH | ULTRA` scale as the shadow presets, so a level can be used directly as a preset key:

- `ShadowQualitySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'ULTRA'])` and its `ShadowQuality` type in `schemas/_HelperSchemas.ts` (the type on `aekasha/schemas`). The light JSON `shadowPreset` and the sky box sun light (`SUN_LIGHT_DEFAULTS.shadowPreset: 'MEDIUM'` in `features/skybox/SkyLights.ts`; `SkyBoxSchema.ts`) use it.
- `SHADOW_PRESETS: Record<ShadowQuality, ShadowPreset>` in `kernel/light/Light.ts`.

**Shared type.** Add a general `QualityLevelSchema` (same enum) and `QualityLevel` type to `schemas/_HelperSchemas.ts`, with `QUALITY_LEVELS` (ordered array), `compareQualityLevels(a, b)` and `minQualityLevel(...levels)`. Then make `ShadowQualitySchema` an alias of it, keeping its `.describe` text so the generated JSON schema (`.schemas/`) is unchanged. This is non-breaking.

- **Imports:** `DeviceCapabilities` imports only the `QualityLevel` type (`import type`) and string literals, never `kernel/light/Light.ts`, so a report reads no renderer or light code.

**Categories.**

```ts
type DeviceLevelCategory = 'gpu' | 'cpu' | 'memory' | 'gpuMemory';

type DeviceLevels = {
  overall: QualityLevel;
  gpu: QualityLevel;              // always set (heuristic when the benchmark is off, §2)
  cpu: QualityLevel;              // always set (cores only when the benchmark is off)
  memory: QualityLevel | null;    // null = UNKNOWN (no navigator.deviceMemory)
  gpuMemory: QualityLevel | null; // null = UNKNOWN (common, §1.1)
  /** How each level was decided; shown in the debug tab. */
  sources: Record<DeviceLevelCategory, 'BENCHMARK' | 'HEURISTIC' | 'API' | 'UNKNOWN'>;
  /** A debug override is active (Phase 3). */
  forced: boolean;
};
```

**Default thresholds** (`levelThresholds` in §2 overrides them). A category gets the highest level whose threshold it meets. The benchmark-based numbers are starting values that Phase 2 calibrates.

| Category | Input | LOW | MEDIUM | HIGH | ULTRA |
| --- | --- | --- | --- | --- | --- |
| GPU (benchmark) | headroom = `estimatedFps / effectiveFpsTarget` at the target resolution (Phase 2 calibration: the reference frame is a `HIGH` frame) | < 0.5 | ≥ 0.5 | ≥ 1 | ≥ 2 |
| GPU (heuristic) | adapter info, when the benchmark is off | fallback adapter or no GPU API | integrated, or WebGL2 only | discrete or unified memory | never (only the benchmark can rate ULTRA) |
| CPU | the lower of: cores, and benchmark score | < 4 cores, < 6000 | ≥ 4, ≥ 6000 | ≥ 6, ≥ 12000 | ≥ 12, ≥ 20000 |
| Memory | `deviceMemory` GB | < 4 | ≥ 4 | ≥ 8 (the API's cap) | — (see rules) |
| GPU memory | heuristic MB | < 1024 | ≥ 1024 | ≥ 2048 | ≥ 4096 |

**Rules.**

- **Overall** is the lowest of the known category levels, because the weakest part is the bottleneck. `UNKNOWN` categories are skipped.
- **Memory cap:** `deviceMemory` never reports more than 8, so a reading of 8 is marked capped. It shows as `HIGH` but doesn't limit `overall`.
- **GPU depends on resolution:** the same GPU rates lower on a 4K DPR-2 display than at 1080p. The level answers "what can this device run here", not "how fast is this chip".
- **Shadow level:** `recommendations.shadowQuality` is `min(gpu, gpuMemory ?? gpu)`, because ULTRA's 4096² shadow maps need memory headroom. An app can pass it as a light's or the sky box sun light's `shadowPreset`, or use `SHADOW_PRESETS[level]` (`kernel/light/Light.ts`). The engine doesn't apply it (§1.3). A future `shadowPreset: 'AUTO'` that resolves to this level would be a separate change.
- **Intended use per category** (a guide for apps, not enforced):
  - GPU: rendering settings (shadows, PostFX, antialias, pixel ratio, sky/env bake resolution), the LOD bias (`setLodBias`) and the instance sets' density, or no set at all, on a weak device (p354 §5 left choosing their backend by device here: on WebGL2 a set runs its CPU backend, `src/_engine/features/instancing/CLAUDE.md`'s Instance sets, which past about 20k spread-out instances draws more than tiled pools).
  - CPU: physics sub-steps, entity and character counts, spatial-index density.
  - Memory and GPU memory: texture resolution, streaming radius, cache sizes.

---

## 4. Storage and cache validity

- LS key `AEK_deviceCapabilities`, read and written with `lsGetItem`/`lsSetItem` (`utils/LocalAndSessionStorage.ts`, which already handles unavailable storage).
- Stored: `{ reportVersion, fingerprint, measuredAt, measurements }`. Only raw measurements are stored. The verdict is always recomputed, so changing targets in a new app version needs no re-measure.
- A stored result is used only when all of these hold:
  - `reportVersion` matches.
  - It is newer than `maxAgeDays`.
  - The fingerprint matches.
- Fingerprint: a hash of UA string, adapter `vendor/architecture/device/description` (or the WebGL unmasked renderer), screen size × DPR and `hardwareConcurrency`. A new GPU, a browser update, a different monitor or switching to the WebGL path makes it stale.
- The fingerprint needs a `requestAdapter()` on every boot (typically a few ms to tens of ms). That is the whole cost of a cache hit. The benchmark modules are dynamically imported only on a cache miss, so a cache hit never downloads them.
- A benchmark run while `document.hidden` (throttled) is postponed until the page is visible. A run that blew through `budgetMs` because of stalls is marked and not stored.
- Everything stays in the browser. The report is never sent anywhere by the engine. Hardware detail is fingerprinting-grade data, so an app that uploads it for telemetry needs to handle it accordingly.

---

## 5. Flow

**At init** (`bootEngineAsync` in `src/_engine/kernel/init/Boot.ts`, which `InitEngine` and `mountAekasha` run): right after `loadConfig()`/`consoleBootText()`, before `createRootScene()` and `installKernel()`. It runs this early so the features' installs (the Rapier worker boot), asset work and scene registration don't compete with the CPU benchmark:

```ts
if (getConfig().deviceCapabilities?.runAtInit) {
  const { runDeviceCapabilityCheck } = await import('../deviceCapabilities/DeviceCapabilities');
  await runDeviceCapabilityCheck();
}
```

The dynamic import keeps the module out of the main chunk for apps that don't use it (its own chunk: check it with `yarn sbp`). The report is ready for the app's `start` through `getDeviceCapabilityReport()`. A first-run benchmark delays boot by up to `budgetMs`. No engine UI exists at that point (the HUD and the app's loading overlay come later), so the app's page covers it.

**From app code at runtime**: when the main loop is running and `pauseMainLoop` is true, the check pauses it (`toggleMainPlay(false)` in `kernel/loop/MainLoop.ts`), runs, then restores the previous `masterPlay` state (it reads it first via `getReadOnlyLoopState()`). Otherwise the game's own rendering would share the GPU with the benchmark and skew it.

**Steps:**

1. **Probe** (`kernel/deviceCapabilities/DeviceProbe.ts`):
   - WebGPU: `navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })` for `info`, `features`, the relevant `limits` and `getPreferredCanvasFormat()`.
   - WebGL2: a temporary `webgl2` context for `MAX_TEXTURE_SIZE`, `MAX_SAMPLES`, extensions and `WEBGL_debug_renderer_info` (when allowed). The context is released with `WEBGL_lose_context`. This runs when WebGPU is missing, and always for the WebGL2 fallback fields.
   - Memory, cores, display (`screen`, DPR, `matchMedia` for HDR/P3/coarse pointer), `crossOriginIsolated`, `userAgentData.mobile` (UA fallback).
   - GPU memory heuristic (§1.1).
2. **Refresh rate**: median rAF interval over ~30 frames.
3. **GPU benchmark** (`kernel/deviceCapabilities/GpuBenchmark.ts`, dynamically imported):
   - Own device and offscreen target at the target resolution, capped at 3840×2160.
   - Workload A: blended fullscreen quads running a fixed-cost fragment shader (ALU loop + texture sample), which measures fill rate × shader cost.
   - Workload B: instanced triangles, which measures geometry throughput.
   - Warm-up submit first (pipeline compile excluded). Then double the workload until one batch takes ≥ ~8 ms or the budget is used.
   - Timing: `timestamp-query` when the adapter has it, otherwise wall time around `queue.onSubmittedWorkDone()`.
   - WebGL2 path: the same workloads in GLSL, synced with a 1-pixel `readPixels`, plus `EXT_disjoint_timer_query_webgl2` if exposed.
   - `device.destroy()` / lose context at the end.
4. **CPU benchmark** (`kernel/deviceCapabilities/CpuBenchmark.ts`, dynamically imported): about 150 ms of typed-array mat4 multiplies (ECS-transform-like work) after a JIT warm-up, reported as ops/ms.
5. **Score** (`kernel/deviceCapabilities/DeviceScoring.ts`, pure functions, unit-tested next to it):
   - Predict the reference-frame time from the throughputs and the target pixel count, then derive `estimatedFps`.
   - Normalise the gpu/cpu/memory/gpuMemory scores.
   - Rate each category's level from the thresholds, then the overall level (§3.1). An `UNKNOWN` category never lowers the overall level.
   - Run the target checks (including `minLevels`), then build the recommendations (the pixel ratio is solved against the FPS target, the shadow quality comes from the levels).

---

## 6. Phases

### Phase 1: Probe, config, cache, API (no benchmark) — done

- `QualityLevelSchema`/`QualityLevel` in `schemas/_HelperSchemas.ts`, with `ShadowQualitySchema` aliased to it, and the helpers (§3.1).
- `DeviceCapabilitiesTypes.ts`, `DeviceProbe.ts`, `DeviceScoring.ts` (levels from probe data only: GPU from heuristics, CPU from cores, memory and GPU memory from the API and heuristics), `DeviceCapabilities.ts` (API, LS cache, fingerprint, listeners), with `*.test.ts` next to each (`yarn test`, in Node: no module reads a browser global at load).
- `AppConfig.deviceCapabilities` + defaults in `kernel/config/Config.ts`.
- `runAtInit` hook in `kernel/init/Boot.ts`.
- The API on the `aekasha` entry (`src/_engine/index.ts`; `yarn verify:baselines --update` records the new names).
- FPS check is `UNKNOWN` in this phase.
- Engine minor bump + CHANGELOG entry.

As built (where the code differs from §2-§5 above; later phases build on this):

- **Names** (the coding standards): `runDeviceCapabilityCheckAsync` (returns a promise), `onDeviceCapabilityReport(listener)` returning its remover (not `addDeviceCapabilityListener`). `evaluateDeviceCapabilities` returns `null` before any check (it has no measurements to score). `clearStoredDeviceCapabilityReport` keeps the last report.
- **Defaults live in the modules, not `Config.ts`** (p612 D4: `loadConfig` holds none): the targets' and thresholds' in `DeviceScoring.ts` (`DEFAULT_DEVICE_TARGETS`, `DEFAULT_DEVICE_LEVEL_THRESHOLDS`), `saveToLS` / `maxAgeDays` in `DeviceCapabilities.ts`. `AppConfig.deviceCapabilities` is the type `DeviceCapabilitiesConfig` (`DeviceCapabilitiesTypes.ts`).
- **The config holds only what runs**: `runAtInit`, `saveToLS`, `maxAgeDays`, `targets`, `levelThresholds`. Phase 2 adds `benchmark` (`enabled`, `budgetMs`), `targets.referenceFrame`, the check's `benchmark` / `pauseMainLoop` / `onProgress` options and the GPU-headroom and CPU-score thresholds.
- **Thresholds** are `DeviceLevelBands` per input (the least value for each level above `LOW`): `cpuCores` `{ MEDIUM: 4, HIGH: 6, ULTRA: 12 }`, `deviceMemoryGB` `{ MEDIUM: 4, HIGH: 8 }` (no `ULTRA`: the browser's cap), `gpuMemoryMB` `{ MEDIUM: 1024, HIGH: 2048, ULTRA: 4096 }`.
- **The scale is zod-free**: `QUALITY_LEVELS`, `QualityLevel`, `compareQualityLevels`, `minQualityLevel` in `utils/QualityLevel.ts` (on `aekasha`), so the check compares levels without loading zod; `_HelperSchemas.ts`' `QualityLevelSchema = z.enum(QUALITY_LEVELS)` and `ShadowQualitySchema` its `.describe`d copy (`.schemas/` unchanged).
- **No WebGPU typings** (TypeScript 5.4, `types: ["node"]`): `requiredGPUFeatures` is `string[]`, and `DeviceProbe.ts` types the adapter fields it reads (`ProbeGpu`, `ProbeGpuAdapter`). The probe takes its browser inputs as a `DeviceProbeEnv` (`readBrowserProbeEnv()` reads them at the call), so its tests pass fakes.
- **The probe**: WebGPU adapter (high performance; a null or thrown request is no WebGPU), `info` or the older `requestAdapterInfo()`, the features, 17 limits read by name, the canvas format; the WebGL2 context always (`RENDERER` first, `WEBGL_debug_renderer_info` only when it's masked, then the context lost). `classifyGpu` reads the identity strings, the WebGL renderer string added to WebGPU's coarse info: software (SwiftShader, llvmpipe, …), Apple silicon (unified), integrated (Intel but Arc, AMD APUs, mobile GPUs), discrete (NVIDIA, AMD RX). `isFallbackAdapter` is also true for a renderer named like software. GPU memory: 50 % of `deviceMemory` unified, 25 % integrated, else `UNKNOWN`. `display.width` / `height` are `screen`'s; `refreshHz` is null until Phase 2.
- **The fingerprint**: an FNV-1a hash of the UA, the adapter's vendor / architecture / device / description (else WebGL's unmasked vendor and renderer), `screen` size × DPR and the cores. Its adapter request is reused by the probe on a miss.
- **Scoring without a benchmark**: GPU `LOW` (no API, software), `MEDIUM` (WebGL2, integrated, or unknown), `HIGH` (discrete or unified); CPU from the cores (unknown: `MEDIUM`, source `UNKNOWN`, not counted overall); the GPU's score is null. A memory target over 8 is checked against 8, warned once per page.
- **Recommendations from the levels** (`recommendDeviceSettings(levels, measurements)`, which the Phase 3 forced levels reuse): pixel ratio `min(DPR, { LOW: 1, MEDIUM: 1.5, HIGH: 2, ULTRA: 2 }[gpu])` (Phase 2 solves it against the FPS target), antialias at GPU ≥ `HIGH`, PostFX at ≥ `MEDIUM`, shadows `min(gpu, gpuMemory)`, backend WebGL2 without WebGPU or on a fallback adapter, physics `MAIN_THREAD` on a `LOW` CPU.
- **Checks**: `failedTargets` is the check names; `gpuFeatures`' `measured` is the required features present, `minLevels`' the levels checked (`"overall: HIGH"`). With `unknownIs: 'FAIL'` every device fails until Phase 2 (the `fps` check is always `UNKNOWN`).
- **The boot hook** (`Boot.ts`' `runDeviceCapabilityCheckAtBootAsync`) catches a failed check and warns: the boot goes on without a report.
- The Hub page and the readme stay in Phase 3, on this branch.

### Phase 2: Benchmarks and FPS target — done

- Refresh-rate sampling, `GpuBenchmark.ts` (WebGPU + WebGL2 paths), `CpuBenchmark.ts`, `budgetMs`, the hidden-tab deferral, main-loop pausing for runtime calls and `onProgress`.
- The config and option keys Phase 1 left out (see its As built), `DEVICE_CAPABILITY_REPORT_VERSION` bumped (the measurements gain `benchmark` and `cpu.benchScore`), and the GPU level from the benchmark's headroom (`sources.gpu: 'BENCHMARK'`, `ULTRA` possible).
- `resolution: 'CANVAS'` reads `getCanvasSize()` (`kernel/render/CanvasSize.ts`) × DPR, not the window: in an embed (`mountAekasha`) the canvas is the container's size.
- The full verdict with `estimatedFps` and the pixel-ratio solver.
- Calibrate the `referenceFrame` defaults: run the example app's `sceneTestECS` on 2–3 machines (integrated laptop GPU, Apple silicon, a discrete GPU). Compare the predicted and observed FPS (debug stats panel) and tune the constants. Record the numbers in this plan.
- Calibrate the level thresholds on the same machines: the GPU headroom bands and the CPU benchmark-score bands. As a sanity check, each machine's GPU level should match the shadow preset it actually runs at the target FPS.

Worked in three review sections: 1 the measuring (bullets 1 and 3, the measuring's keys, the version bump), 2 the scoring (bullets 2 and 4), 3 the calibration (bullets 5 and 6).

As built (sections 1-2):

- **Modules** (all `import()`ed by `DeviceCapabilities.ts` only when it measures with the benchmark, so a stored result's boot downloads none): `DeviceBenchmark.ts` (the steps in order, the budget, the hidden-page wait, the stall mark, the progress), `GpuBenchmark.ts` (the measuring loop, `clampBenchmarkSize`), `GpuBenchmarkWorkloads.ts` (the constants and the backend's shape both backends share, apart so they import no module that imports them), `GpuBenchmarkWebGPU.ts`, `GpuBenchmarkWebGL2.ts`, `CpuBenchmark.ts`; tests next to each but the two backends (no GPU in Node: checked in the Windows Chrome, below).
- **The measurements**: `benchmark: { gpu, durationMs, isStalled } | null` (null: not benchmarked; `gpu` null: its GPU part failed, warned), `gpu: { api, width, height, fillRateMPixOpsPerMs, trianglesPerMs, usedTimestampQuery }`, `cpu.benchScore` (4×4 matrix multiplies per ms on the main thread, fixed inputs: a product fed back shrinks toward denormals), `display.refreshHz` (the median of up to 30 rAF intervals, snapped to a common rate within 4 %). `DEVICE_CAPABILITY_REPORT_VERSION` 2. A stored result without a benchmark is measured again when the check wants one.
- **The GPU benchmark**: its own device on the probe's adapter (`requestDevice`, `timestamp-query` when the adapter has it) or a WebGL2 context, on the API `recommendations.renderBackend` would pick; an offscreen RGBA8 texture or renderbuffer at the target resolution (3840×2160's pixels at most, aspect kept), no canvas. Fill: blended fullscreen triangles of a 16-iteration ALU loop between two samples of a 64² noise texture. Geometry: 2 px triangles in **scanline order**, a cell each, wrapping over the target, each vertex rotated by its triangle's hash: at hashed positions they measured the target's memory traffic instead (1.0 vs 2.1 M/ms at 720p vs 1080p), in order they hold ~7.2 M/ms from 720p to 4K. A batch grows ×2 to ×16 until it takes 8 ms, the next would pass the deadline, or it reaches its cap. A grown batch then repeats until the workload's budget ends (256 at most), the fastest the reading (Phase 2 section 3: a GPU that idles at a low clock ramps up under them); one that didn't grow in time is read from its last. Fill gets 60 % of the GPU's time. A timer query's reading is kept when positive and within the wall time; a batch over 2 s fails the device.
- **The budget** (`benchmark.budgetMs`, default 1500): the refresh rate a quarter (500 at most), the CPU a tenth (50-150) plus a fifth of that to warm up, the GPU the rest. **Stalled** (`isStalled`, not stored): the page hidden meanwhile, or over twice the budget.
- **Options**: `benchmark`, `pauseMainLoop` (only when the loop is playing a frame: the boot's check never starts it; resumed unless played meanwhile), `onProgress(phase, progress01)`, its progress the whole check's share (growing only; a stored result reports `PROBE` 0 and `DONE` 1), a throw logged.
- **The target resolution**: `resolveTargetPixelSize` (`DeviceScoring.ts`): `'CANVAS'` is `getCanvasSize()` (1280×720 while it has no size) × the measured pixel ratio, for the benchmark's size and for the verdict, which is scored with the canvas at its scoring (`evaluateDeviceCapabilities` too).
- **The verdict**: `estimateFps` = 1000 ÷ (`fullscreenPasses` × pixels ÷ fill + `trianglesPerFrame` ÷ triangle rate), rounded to 0.1; the `fps` check against `effectiveFpsTarget`; the GPU's level by the headroom (`gpuHeadroom` bands, source `BENCHMARK`, else the adapter's heuristic); the CPU's the lower of the cores' and the score's (`cpuBenchScore` bands; both bands' values are section 3's, below), the score alone counting when the cores are unknown; `scores.gpu` the headroom of `ULTRA`'s, `scores.cpu` the lower of the two. `solvePixelRatio`: the device's ratio, then 2, 1.75 … 0.5 below it, the first holding the effective target (0.5 when none); without a benchmark the Phase 1 table (`recommendDeviceSettings`' optional `solvedPixelRatio`, so Phase 3's forced levels keep the table).
- **Memory** (Chrome 157 reports `deviceMemory` 32, not 8 at most): only a reading of exactly 8 is "maybe capped" (it doesn't lower the overall, and checks a target over 8 as `UNKNOWN`); no target clamp and no warning; `deviceMemoryGB` bands `{ MEDIUM: 4, HIGH: 8, ULTRA: 16 }`. §1.1's table and risk 2 are out of date on this.
- **Checked in the Windows Chrome 157 (RX 7900 XT, 144 Hz)**: WebGPU fill ~32 MPix-ops/ms, WebGL2 ~39, both ~7.2 M triangles/ms, CPU ~26k, the benchmark ~0.5 s, timer queries on both. From the running app: the loop paused during the GPU step and played after, the result stored (version 2), the next check from the cache.

As built (section 3, calibration):

- **Compared on GPU time, not FPS** (first; replaced, see the calibration tool's last version below): an observed frame rate is capped at the refresh rate (144 here, so a strong GPU can't be compared at all); `onGpuFrameTime` gives the frame's GPU ms (WebGPU sums the passes' times, which overestimates a tile-based GPU's frame: note it with Apple silicon's figures).
- **A third reference frame term, `fixedMPixOps`** (default 16): the work that doesn't grow with the resolution, in the fill rate's units so it takes longer on a slower GPU. `sceneTestECS` showed it: ~0.49 ms fixed and ~0.04 ms a megapixel, so no passes-and-triangles frame fits it within ±25 % at more than one size. The prediction is (`fixedMPixOps` + `fullscreenPasses` × megapixels) ÷ fill + triangles ÷ triangle rate.
- **Calibrated against the game-like scenes, not `sceneTestECS`**: it's a test scene of 12 draws and 12.6k triangles, mostly fixed cost; fitted to it, the reference frame would be trivial and rate nearly every GPU `ULTRA`. The default `{ fixedMPixOps: 16, fullscreenPasses: 18, trianglesPerFrame: 500_000 }` fits the gym, the terrain showcase and the large world within 25 % from 540p to 1080p, and overpredicts the light scenes (~3× at 1080p: conservative).
- **The calibration tool**: `kernel/deviceCapabilities/debug/_dbg__DeviceCalibration.ts` (debug env; Phase 3's tab can call it). From the browser's console in `yarn dev` with `?isDebug=true` and the scene running: `(await import('/_engine/kernel/deviceCapabilities/debug/_dbg__DeviceCalibration.ts')).measureDeviceCalibrationAsync()`. It benchmarks when the report has no GPU benchmark, or when `rebenchmark: true` asks (stored; right after the scene a GPU still clocked up can read above a cold check, the M2 up to 1.4×). It samples the scene's GPU time and frame interval (120 frames after 30) at the renderer's pixel ratio, 0.7 × and 0.5 × it (put back after). Then it fits the frame by least squares (`fitReferenceFrame`, tested) to the GPU-bound samples only (`limitedBy: 'GPU'`, `classifyCalibrationSample`, tested): a frame interval over 1.1× the refresh interval with the GPU time not under 0.7× it (an overcounted GPU time counts as GPU-bound). `REFRESH` and `CPU` samples are logged and left out. It fits the frame interval less the triangles' time over the megapixels: the slope × fill gives the passes, the intercept × fill the fixed work. One size fits the passes alone at the reference frame's `fixedMPixOps`. `observedOverPredicted` is the frame interval ÷ the prediction, for a GPU-bound sample only. Why the frame interval at a GPU-bound load: the benchmark measures a GPU clocked up by its repeats, so only a busy GPU's time compares with it (the 7900 XT's trace below), and on a tiler only the frame interval is the frame's time (the M2's GPU times below). On a display without variable refresh, a GPU-bound frame may wait for a refresh, so the fit errs high (conservative). The M2's terrain showcase at ratio 2 (31.25 ms at 5.69 MP, 103k triangles, fill 3.87) fits 18.3 passes at 16 fixed: the default frame.
- **The tests** score with a reference frame and benchmark bands of their own (`TEST_FRAME`, `TEST_BANDS` in `DeviceScoring.test.ts`), so a new calibration changes none of them.
- **Two machines only**: the RX 7900 XT desktop and an Apple M2 (no integrated-laptop GPU to measure). The M2 is the low end of the data.
- **The reference frame kept at `{ 16, 18, 500_000 }`**. The second session on the 7900 XT (its window at pixel ratio 1.5, 1.05 and 0.75: 5.4, 2.7 and 1.4 MP) predicts the terrain showcase within 17 % and overpredicts the gym and the large world by 1.3-1.8× (conservative). Both sessions' game scenes fitted together give `{ fixedMPixOps: 16.5, fullscreenPasses: 14.1 }`. That fit is void: it paired the 7900 XT's scene timings, taken at a light load at a low clock, with a benchmark that measured the same low clock (see the 7900 XT's trace below). Against the fixed benchmark, the frame is checked on the one GPU-bound observation, the M2's terrain showcase at ratio 2, and fits it exactly. The fixed work of one scene differs between sessions (gym 16.7 then 0.3, large world 21.0 then 4.7). This is probably the GPU's clock at light loads (~1 ms frames at 144 Hz), so a strong GPU's fixed term is noise.
- **The M2's GPU times aren't GPU time.** Its summed pass times read 59-82 ms in the gym and the large world, yet both held 60 fps at pixel ratio 2 and 1 (16.7 ms at most), an overcount of 3.5-5×. The terrain showcase read 124 ms at ratio 2 while showing 32 fps (~31 ms, ~4×), and 43 ms at ratio 1 while holding 60 (≥ 2.6×). So on Apple silicon (likely any tile-based GPU) WebGPU's summed pass times can't calibrate anything: only the frame rate below the refresh rate can. The calibration tool samples the frame interval too (`frameMs`), marks a GPU time over it (`isGpuTimeOverFrame`) and fits the frame interval of GPU-bound samples only (see the tool above).
- **The benchmark underrates the M2 by 2.6-5×.** The default frame predicts 82.6 ms at its 5.7 MP (12 fps): the terrain showcase ran at 32 fps (2.6× faster), the gym and the large world at 60 or more (≥ 4.9×). At 1.4 MP it predicts 30.6 ms, and all three held 60 (≥ 1.8×). The 7900 XT fits the same frame, so the error is in how the benchmark compares the two GPUs. It rates the M2's fill 1/21 of the 7900 XT's, but the terrain showcase, the heaviest per pixel, runs at about 1/9 (~31 vs 3.4 ms at 5.7 and 5.4 MP). Two suspects:
  - **A cold GPU** (this one, see the M2's trace below): the M2's fill (1.48, the same in its three runs) came from the stored benchmark, maybe measured at boot. The batches wait on the GPU between submits, so a GPU that clocks down when idle is measured at a low clock. The 7900 XT's fixed term shows the same effect at light loads.
  - **The workload:** blended fullscreen triangles, maybe slow on a tiler for a reason of their own.
  
  The timings themselves are bounded: the wall clock caps a timer reading at 1.5× the wall time + 1 ms, so a broken timer can't explain 2.6-5×. The tool's `rebenchmark: true` measures the benchmark again with the scene's GPU at its clock, which tells the two apart (see Still open).
- **`gpuHeadroom` bands `{ MEDIUM: 0.5, HIGH: 1, ULTRA: 2 }`** (were `{ 1, 2, 4 }`). The reference frame is fitted to the gym and the large world, which run `HIGH` shadows, the AO PostFX and antialias (`src/index.ts`). So holding it at the target is `HIGH` (and the recommendations turn antialias on from `HIGH`). `MEDIUM` holds half of it, enough with `MEDIUM` shadows and the PostFX off. `ULTRA` holds twice it, enough for `ULTRA`'s 4096² maps. With the default frame at 60 fps and the old benchmark's readings (the fixed one's are in the verdict below): the 7900 XT is `ULTRA` from 1080p (headroom 9.4) through its 5.4 MP window (4.5) to 4K (3.1; `HIGH` under the old bands). The M2 is `LOW` at its pixel ratio 2 (0.20) and `MEDIUM` at 1 (0.54). Its solved pixel ratio is 0.5, where 57 fps is the nearest to 60. The sanity check against the shadow presets:
  - **7900 XT:** it renders the gym's `HIGH` shadows and AO in 2.9 ms at 5.4 MP, so `ULTRA` fits.
  - **M2:** by these bands it should be `HIGH` at ratio 1, where all three scenes hold 60. At ratio 2 it should be `MEDIUM` to `HIGH`: the gym and the large world hold 60, the terrain showcase 32. The old benchmark rated it `MEDIUM` (0.54) and `LOW` (0.20), one to two levels low. That was the benchmark's 2.6-5× error above, not the bands'. With the fixed benchmark it rates `HIGH` (1.45) and `MEDIUM` (0.53).
- **`cpuBenchScore` bands `{ MEDIUM: 6000, HIGH: 12000, ULTRA: 20000 }`** (were `{ 8000, 15000, 25000 }`). The desktop scores 26-27k and the M2 25.4k. Both are 2022+ cores near the top of single-core speed, and the M2 sat 1.7 % over the old `ULTRA` edge, within run-to-run noise. The score is one main-thread core, so the lower bands follow single-core speed. `HIGH` is about half the M2 (a 2018-2020 laptop core), `MEDIUM` about a quarter (a low-end Chromebook or Android core). Those are estimates, not measured. The M2's CPU level is `HIGH` either way: its 8 cores are under the cores' `ULTRA` (12).

Calibration table, first session (GPU ms per frame, the renderer's samples at 1920×1080, 1344×756 and 960×540; fitted: fixed MPix-ops / passes; "default" is the default frame's prediction ÷ observed):

| Machine | Scene | Fill / tris per ms | 1080p | 756p | 540p | Fitted | Default ÷ observed (1080p / 540p) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Windows, Chrome 157 WebGPU, RX 7900 XT (discrete) | sceneTestECS (12.6k tris, 12 draws) | 32.5 / 7.0M | 0.589 | 0.531 | 0.515 | 15.7 / 1.6 | 2.9 / 1.7 |
| 〃 | thirdPersonGymScene (36k, 72) | 〃 | 1.596 | 1.045 | 0.791 | 16.7 / 16.8 | 1.07 / 1.08 |
| 〃 | terrainShowcase (103k, 31) | 〃 | 1.723 | 1.053 | 0.686 | 11.2 / 21.5 | 0.99 / 1.24 |
| 〃 | largeWorld (464k, 136) | 〃 | 1.591 | 1.172 | 0.916 | 21.0 / 13.9 | 1.07 / 0.93 |
| 〃 | skyShowcase (78k, 38) | 〃 | 0.357 | 0.225 | 0.207 | 4.2 / 3.3 | 4.8 / 4.1 |
| 〃 | scene01 (19k, 21) | 〃 | 0.629 | 0.559 | 0.542 | 16.4 / 1.9 | 2.7 / 1.6 |

Second session (`measureDeviceCalibrationAsync` at the window's own size: the 7900 XT at pixel ratio 1.5, 1.05 and 0.75, 2781×1957, 1946×1370 and 1390×978 = 5.44 / 2.67 / 1.36 MP; the M2 at 2, 1.4 and 1, 2890×1970, 2022×1379 and 1445×985 = 5.69 / 2.79 / 1.42 MP):

| Machine | Scene | Fill / tris per ms | High | Mid | Low | Fitted | Default ÷ observed (high / mid / low) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Windows, Chrome 157 WebGPU, RX 7900 XT (discrete), 144 Hz, CPU 27.0k | thirdPersonGymScene (34k, 63) | 31.6 / 5.4M | 2.940 | 1.450 | 0.746 | 0.3 / 17.0 | 1.26 / 1.46 / 1.84 |
| 〃 | terrainShowcase (87k, 20) | 〃 | 3.424 | 1.936 | 1.169 | 13.4 / 17.4 | 1.08 / 1.09 / 1.17 |
| 〃 | largeWorld (462k, 128) | 〃 | 2.661 | 1.437 | 0.834 | 4.7 / 14.1 | 1.39 / 1.47 / 1.65 |
| macOS, Chrome WebGPU (ANGLE Metal), Apple M2 (unified), 60 Hz, CPU 25.4k | thirdPersonGymScene (34k, 78) | 1.48 / 0.20M | 58.778 (60 fps) | 68.550 | 59.994 (60 fps) | overcounted | ≥ 4.9 / — / ≥ 1.8 (by fps) |
| 〃 | terrainShowcase (103k, 42) | 〃 | 123.789 (32 fps) | 65.058 | 43.135 (60 fps) | overcounted | 2.6 / — / ≥ 1.8 (by fps) |
| 〃 | largeWorld (458k, 134) | 〃 | 69.983 (60 fps) | 74.406 | 81.702 (60 fps) | overcounted | ≥ 4.9 / — / ≥ 1.8 (by fps) |

The M2's GPU ms are WebGPU's summed pass times, which overcount 2.6-5× there. Its "default ÷ observed" is the prediction over the frame interval the frame rate shows: a lower bound at 60 fps, the refresh rate.

**Re-benchmarked on the M2** (`rebenchmark: true` in the gym at pixel ratio 2, twice, and again after a reload): 1.76 MPix-ops/ms and 205128 triangles/ms every time, to the digit. The stored 1.48 / 199170 had repeated to the digit too.
- **A warmer GPU helps a little:** fill is 19 % over the stored one, but far from the ~3-4 its scenes imply.
- **Readings that repeat to the digit aren't GPU timing:** each batch's time must snap to a clock's steps. It could be the timer query's (quantized, or broken and then rejected for the wall time), or the moment Chrome reports `onSubmittedWorkDone`. Such a step can also be what holds the readings low.

`traceGpuBenchmarkAsync()` (the calibration tool) shows which. It runs the benchmark twice back to back at the renderer's drawing buffer size, with the loop paused and nothing stored. It logs a table per run of every batch: its workload, count, wall time, timer reading, the time kept and which. The backends return both raw readings now (`GpuBatchTiming.wallMs`, `queryMs`), and `runGpuBenchmarkAsync` reports each batch to `onBatchTiming`.

**The M2's trace** (the gym at pixel ratio 2, 2894×1970, run right after the scene played): fill 4.65 and 4.61 MPix-ops/ms, 584k and 491k triangles/ms, every batch on the timer query. That's 2.6× the check's fill and 2.4-2.8× its triangles:
- **The timer is quantized, and that's harmless:** every reading is a multiple of 65.5 µs (2^16 ns: 0.131, 1.049, 8.585, 14.352 ms…), Dawn's timestamp quantization. It's under 1 % of an 8 ms batch. It's why a check repeats to the digit: the same batch count lands on the same step.
- **The GPU's clock is the cause.** The trace ran with the M2 still clocked up from the scene's frames. The check runs after the refresh rate's sampling (~375 ms with the loop paused) or at boot, so the M2 has clocked down. Its two workloads, each only a couple of 8 ms batches with waits between them, don't hold it busy long enough to clock up again. Both workloads are slow by the same ~2.7×, which fits a clock rather than the workload. Apple's GPU spans about 3× between its lowest and highest clocks. The trace's first warm-up batch (10 ms for one pass, 1.2 ms after) shows the ramp too.
- **The fix, `measureThroughputAsync`:** once a batch has grown to 8 ms (or `max`), it repeats it until the workload's budget ends (256 repeats at most) and keeps the fastest by the time a unit takes. That's how a game's frames keep the GPU busy. A repeat that a faster clock brings under 8 ms grows again, so the batches it compares can differ in count.
- **The trace reproduces the check:** it waits `idleMs` (500 by default) with the loop paused before its first run, and adds a `rate` column per batch, so the table shows whether the repeats clock the GPU up.

**The M2's trace with the fix** (the gym at pixel ratio 2, after 500 ms idle, two runs back to back):
- **Run 1, the check's case (a GPU idled down):** fill starts at 1.7, the check's old reading, and reaches 3.8 by the fifth batch. It then wanders 3.2-3.9, sinks to 1.8 over ten batches and jumps back to 3.8, a power state flipping. Triangles climb from 0.27 to 0.63 M/ms over the whole budget, still rising at its end. The fastest: 3.87 / 632k.
- **Run 2, a GPU still clocked up from run 1:** fill starts at 5.3-5.6 and sinks to 3.8-4.4 by the budget's end. Triangles climb from 0.35 to 0.51 M/ms. The fastest: 5.57 / 508k.
- **A bug the trace found, fixed:** run 1 reported 2.12, because the first version compared the batches' times across counts: a 3-pass batch in 8.06 ms beat a 6-pass one in 8.85. The fastest is now by the time a unit takes.
- **Which reading:** the fastest, kept. The table predicts the default frame at 5.7 MP and 1.4 MP from each run, against what the scenes showed: the terrain showcase at 32 fps at 5.7 MP (headroom 0.53, `MEDIUM`), all three at 60 at 1.4 MP (≥ 1, `HIGH`).

  | Run | Statistic | Fill / tris per ms | 5.7 MP | 1.4 MP |
  | --- | --- | --- | --- | --- |
  | 1 | fastest | 3.87 / 632k | 32 fps, 0.53 `MEDIUM` | 87 fps, 1.44 `HIGH` |
  | 1 | median of the later half | 3.50 / 570k | 29 fps, 0.48 `LOW` | 78 fps, 1.31 `HIGH` |
  | 2 | fastest | 5.57 / 508k | 45 fps, 0.75 `MEDIUM` | 118 fps, 1.97 `HIGH` |
  | 2 | median of the later half | 4.67 / 487k | 38 fps, 0.63 `MEDIUM` | 101 fps, 1.68 `HIGH` |

  The fastest of run 1 predicts the terrain showcase's 32 fps exactly. A median of the later repeats spreads less between a cold and a warm start (1.31× vs 1.44×), but it drops run 1 under `MEDIUM`'s edge. A check right after heavy load (an app's re-check mid-game, the tool's `rebenchmark`) overrates the M2 by up to ~1.4×. That's a band at most, and run 2's levels are still right.
- **The M2 vs the 7900 XT:** fill 3.87 against 31.6 is 1/8.2, and the terrain showcase runs at ~1/9.

**The 7900 XT's trace** (the gym, 2997×1957, two runs):
- **It ramps too.** Each run's first four grown fill batches read 32.6-34.7, the old benchmark's reading (31.6-32.5). Then fill settles at 48-55, with the fastest at 58.9 and 57.2. The first grown geometry batches read 6.7-10.2 M/ms (the old reading was 5.4-7.0), then it holds 14.0-14.5 M/ms, with the fastest at 14.46 and 14.50. Under the repeats its spread is ±6 % for fill and ±2 % for triangles. The fastest fill is 10-13 % over the settled level.
- **Its scenes ran at the low clock.** The second session's terrain showcase took 3.42 ms at 5.44 MP. At 144 Hz that's half the GPU's time, too light a load to clock it up. The default frame predicts 3.57 ms from the cold fill (32.6), within 4 %, and 1.97 ms from the fastest (58.9). The M2's terrain showcase at ratio 2 was GPU-bound (32 fps against a 60 Hz display) and fits its fastest fill. So the old calibration paired low-clock scene timings with a low-clock benchmark, and it fitted for that reason only. The M2's old reading also fell further (1.76 against 3.87) than the 7900 XT's (32.6 against 58.9). That's why the old benchmark rated the M2 at 1/21 of the 7900 XT, and the fixed one at 1/15. The terrain showcase's 1/9 is the light-loaded 7900 XT's figure.
- **Calibrating needs GPU-bound samples.** The benchmark measures a clocked-up GPU. So only a scene that holds the GPU busy, with a frame rate under the refresh rate, compares with it. The calibration tool's fit, from GPU times at any load, does not: on the 7900 XT it gives ~34 passes at 16 fixed. On these two machines the only GPU-bound sample is the M2's terrain showcase at ratio 2.
- **The verdict, default frame and bands kept, fastest reading:**

  | GPU | 1080p | 5.4-5.7 MP | 4K (8.3 MP) | 1.4 MP |
  | --- | --- | --- | --- | --- |
  | RX 7900 XT (58.9 / 14.46M) | 17.8 `ULTRA` | 8.5 `ULTRA` | 5.9 `ULTRA` | 22.5 `ULTRA` |
  | Apple M2 (3.87 / 632k, run 1) | 1.15 `HIGH` | 0.53 `MEDIUM` | 0.38 `LOW` | 1.45 `HIGH` |

  Headroom at 60 fps. The M2's levels match what its scenes show at ratio 2 and 1, and the 7900 XT renders the gym's `HIGH` shadows and AO in 2.9 ms at 5.4 MP even at its low clock. The 7900 XT would be `ULTRA` from any reading in its trace, the cold one included.

**The calibration tool fits GPU-bound samples only** (decided in review: rather than drop the fit for a report of predicted against observed frame rates). See the tool's bullet above. On a strong GPU it fits nothing unless a scene is heavy enough to fall under the refresh rate. On a weak GPU it fits every sample that does.

Left for a later machine: a GPU between these two (an integrated laptop GPU) would test the frame's middle with the tool, on a scene under its refresh rate.

### Phase 3: Debug tab and level override — done

- `registerDeviceCapabilitiesDebugGUI()` in `DeviceCapabilities.ts` (the thin side: `loadDebugModuleAsync(() => import('./debug/_dbg__DeviceCapabilities'))`, called from `Boot.ts`' debug step as the camera's and light's are) → `kernel/deviceCapabilities/debug/_dbg__DeviceCapabilities.ts`, a `createDebuggerTab({ id: 'deviceCapabilitiesControls', title, icon, content, ... })` (`debug/DebuggerGUI.ts`; `src/_engine/debug/CLAUDE.md`'s drawer tabs), and the id added to `DEFAULT_DEBUG_DRAWER_TAB_ORDER` (`kernel/config/Config.ts`).
- Tab contents, on the UI kit (a `{ pane: true, content: [...] }` section is a property grid of its fields):
  - Measurements and checks as a kit table (`createTable`, `aekasha/ui`: a row per target, PASS/FAIL/UNKNOWN as its tone) or a `debuggerListCMP`.
  - The levels per category and overall, with their `sources` (monitors, or kit badges).
  - Buttons "Re-run (force)" and "Clear stored result".
  - Debug-only **forced levels** (`lsKey` + `persistKeys`): overall and/or per category, each `OFF` or `LOW`…`ULTRA` (selects). When set, `getDeviceCapabilityReport()` returns the forced levels (`levels.forced: true`) and the recommendations derived from them, so developers can test the LOW path on a strong machine. The override has no effect outside `IS_DEBUG_ENV`.
- The profiler (`debug/Profiler.ts`): the GPU memory tab's default budget from the device's GPU memory level when there is one (p345 §2.4: the tab's budget is one MB figure, 512 by default (`DEFAULT_BUDGET_MB` in `debug/gpuMemory/_dbg__GPUMemory.ts`), saved per browser under `AEK_debugGPUMemory`, the bar red and one debug toast per scene over it; the tab's own saved budget still wins), and the device's levels as an Overview row, so the measured figures sit next to the device's budgets.
- Example app: enable `runAtInit` in `src/CONFIG.ts` and pass `recommendations.pixelRatio`/`antialias` to `createRenderer` in `src/index.ts`. App minor bump.
- The Hub: the feature on a page (the Rendering feature page, `hub/pages/features/rendering/`, or a page of its own with `aek:covers`), its snippet from `src/index.ts` through a `#region`; `readme.md`'s Features list.

Worked in three review sections: 1 the tab and the forced levels (bullets 1-2), 2 the profiler (bullet 3), 3 the example app, the Hub, the readme and the versions (bullets 4-5; `yarn verify:baselines --update` and `yarn verify:scenes`' debugger configuration's tab order baseline, which gains the tab, there too).

As built (section 1):

- **The forced levels are applied in the scoring**, not in `getDeviceCapabilityReport()` alone: `scoreDeviceCapabilities`' optional `forced` (`ForcedDeviceLevels`, `@internal` in `DeviceScoring.ts`), through `applyForcedDeviceLevels` (tested). So the report, `evaluateDeviceCapabilities` (a settings menu's "can this run ULTRA") and the `minLevels` check all read them; the measured figures, the scores, the `fps` check and the sources stay the device's.
- **A forced `overall`** sets every category not forced on its own (an unknown memory or GPU memory stays unknown), so the recommendations follow it (§3.1's recommendations read the categories, not the overall). The overall is then the lowest again, a forced category counted even where the device's isn't (an unknown CPU, a memory reading of 8). A forced GPU level (or overall) suggests its level's pixel ratio (Phase 1's table), not the solved one.
- **The state is the tab's, the override `DeviceCapabilities.ts`'**: the tab persists its selects (`AEK_debugDeviceCapabilities`, `forced`), and hands them to `_setForcedDeviceLevels` (`@internal`, a no-op outside `IS_DEBUG_ENV`) at its registration and on every change. That re-scores the last report with its own check's targets (kept as `lastTargets`) and calls the report listeners (`onDeviceCapabilityReport`'s JSDoc says so), so an app that applies the report from a listener follows a forced level live. Nothing forced is ever stored. `_getUnforcedDeviceVerdict` gives the tab the device's own levels to show next to the forced ones.
- **The registration**: `registerDeviceCapabilitiesDebugGUI` (`DeviceCapabilities.ts`) from `Boot.ts`' `bootKernelDebugAsync`, last, through an `import()` as `runAtInit`'s (the module stays a chunk of its own in every build). It runs after a `runAtInit` check and before the features install, so the saved forced levels apply before the app's `start`.
- **The tab** (`debug/_dbg__DeviceCapabilities.ts`, `DeviceCapabilitiesDebug.module.scss`; id `deviceCapabilitiesControls`, last in `DEFAULT_DEBUG_DRAWER_TAB_ORDER`; `keepOnSceneChange`, refreshed by every report): a note while no check has run, the Check row (the tab's last action and the check's progress), "Run the check", "Measure again" (`force`), "Clear the stored result"; Levels (a kit table: category, level (`(forced)` with the warning tone), the device's own, source, score); Forced levels (a select per category and overall, `OFF` or `LOW`…`ULTRA`, and "Clear the forced levels"; the clear-LS button clears them too); Targets (the estimated FPS, the FPS target, meets, and a table of the checks, PASS / FAIL / UNKNOWN as the success / danger / muted tones); Recommendations; Measurements (GPU, benchmark, CPU and memory, display and page folders, shut); Calibration (shut: "Measure the scene" and "Trace the GPU benchmark", the calibration tool's two functions, logged to the console).
- **A new built-in icon, `cpu`** (Bootstrap Icons' `cpu.svg`): every fitting one was another tab's.

As built (section 2):

- **The GPU memory budget** (`debug/gpuMemory/_dbg__GPUMemory.ts`): without a saved budget it follows the device's GPU memory level, `DEVICE_BUDGET_MB` `{ LOW: 256, MEDIUM: 512, HIGH: 1024, ULTRA: 2048 }` (half the least GPU memory of the level's default band, so the browser and the system keep the rest; `LOW` a quarter of `MEDIUM`'s), else the old 512. A report listener applies it, so a check after the boot (or a forced level) moves it; the toast is re-armed. A budget the user sets in the tab is saved and wins (the saved object holds only keys that were set, so `budgetMB` in it means a choice); the tab's clear-LS button puts the device's back. A "Budget from" row says which. Most discrete GPUs have no GPU memory level (§1.1), so they keep 512.
- **The Overview row**: a built-in stats source `device` (`PROFILER_SOURCE.DEVICE`: the report's levels, n/a "no device capability check yet") and the row "Device level" after GPU memory, shown by default: the overall level, the categories in the detail, `(forced)` and the warning tone while the Device capabilities tab forces them. A saved Overview list gets it appended to the engine's rows (`sanitizeOverviewMetrics`).

As built (section 3):

- **The example app applies the pixel ratio only** (decided in review): `src/CONFIG.ts` sets `deviceCapabilities.runAtInit` (its `#region device-capabilities`), and `src/index.ts`' `create-renderer` region passes `recommendations.pixelRatio` as `devicePixelRatio` and keeps `antialias: true`. `takeSnapshotAsync`'s direct path takes its MSAA from the renderer's antialias, so applying `recommendations.antialias` would make `yarn verify:scenes`' snapshots depend on the machine's rated GPU (SwiftShader rates `LOW`); the pixel ratio doesn't reach them (the direct path renders at the snapshot's size, the PostFX path at ratio 1).
- **The report lives apart from the check**: `DeviceCapabilityReports.ts` holds the last report and its listeners (`getDeviceCapabilityReport`, `onDeviceCapabilityReport`, `DeviceCapabilityListener` on the entry from there; `_setDeviceCapabilityReport`, `@internal`, the check's writer). The example app's static import of `getDeviceCapabilityReport` had pulled all of `DeviceCapabilities.ts` (the probe, the scoring, the storage) into the first download, 5.3 kB gzip over the `app` profile's budget (`yarn sbp`); now the app's import costs the small module, and the check stays the chunk `runAtInit` loads. The profiler's source and the GPU memory tab read it there too.
- **The Hub**: a page of its own, `hub/pages/features/device-capabilities/` (Performance group, order 105, Lucide's `cpu` icon added to `hub/_assets/icons/`; no `aek:covers`: the area has no nested `CLAUDE.md`): running the check (the two regions), its cost, what it measures, the levels and their default thresholds, the targets and the verdict, the recommendations, the stored result, debugging (the tab, forced levels, the profiler, calibrating). The Rendering page's renderer section links it.
- **The readme**: a Features bullet after Rendering, and `deviceCapabilities: { runAtInit: true }` in the "Configure the app" example.
- **Versions**: App 1.35.0 (the engine's 6.26.0 is the branch's, from Phase 1); the branch's CHANGELOG entry covers Phases 1-3 (Phase 2 had none of its own).
- **The scene runner**: its baselines are local (`.cache/verify/scenes/<backend>/`), so they're recorded on each machine: the debugger configuration's next run reports the drawer's new tab (the tab order, the tab's shot), the Overview's new row and the GPU memory tab's "Budget from" row; `--update` records them. Every scene's page now runs the check at boot (a fresh browser profile has no stored result: about 0.5 s more on a real GPU, ~2 s on SwiftShader).

### Phase 4: Runtime verification

The prediction (§1.2) compares a synthetic benchmark with a reference frame; Phase 2's calibration showed how far that can be off on a device nobody calibrated (the M2 before the benchmark's fix: 2.6-5×). Phase 4 checks it against the app's own frames: once a scene has run a while, the frames it actually took, and when the device is clearly slower than predicted, the report says so and rates it lower, and the app hears it to offer "lower the settings?". Nothing is changed silently (§1.3).

**Decisions** (reviewed before section 1; the review changed D3, D4, D5, D6, D7 and D8 as noted):

- **D1 Opt-in:** `AppConfig.deviceCapabilities.observe` (`DeviceObserveConfig`): `enabled` (default false), `warmUpMs` (5000: after a scene enters, its first frames compile pipelines and stream assets), `frames` (300 rendered frames a window), `sceneIds` (the scenes observed, default every scene: see D6). It starts once a report with a GPU benchmark exists (nothing to compare without one) and the main loop runs. Its code is a module of its own, `import()`ed by the check only when `enabled`, so an app without it downloads none (`yarn sbp`). The observer gets a callback from the check (no import of `DeviceCapabilities.ts`: a cycle); the check keeps the stored entry's fingerprint and `measuredAt`, so an observation rewrites that entry (with `saveToLS: false` or a stalled benchmark it stays in memory).
- **D2 What a frame gives** (production: no timer queries, so no GPU time): the interval since the previous rendered frame, the main loop's CPU time for the frame (`runFrameWork`, begin to end) and whether the GPU was still busy (D4). `MainLoop.ts`' one `setFrameProbe` slot (the profiler's; on no entry) becomes a list, `addFrameProbe(probe)` returning its remover (`@internal`; the profiler's `_dbg__FrameProbe.ts` moves to it), so the observer and an open profiler both measure. The probe's `end` gets the loop state as a third argument (`Readonly<LoopState>`, the object itself: `getReadOnlyLoopState()` copies, which per-frame code can't).
- **D3 Frames left out:** a scene load (`loopState.isLoadingScene`), the first `warmUpMs` after a scene's load settles (a `loadSettled` scene hook, `addSceneHooks`: a per-frame flag misses a load that settles between two frames), a scene not in `sceneIds`, a hidden page and the frame after it shows again, an editor view (`isSceneSuspended`), a frame the max FPS limiter skipped, a gap over 1 s (the master loop paused runs no frame at all, and the profiler's rule), and a change of the drawing buffer's size (restarts the window). A window that a check (the benchmark pauses the loop) or one of these breaks starts again.
- **D4 What a window says** (`DeviceObservation.ts`, pure, tested): the p50 and p95 interval and CPU time, the share of the sampled frames that began with the GPU still busy, and what held it, by a classifier of its own (the calibration tool's `classifyCalibrationSample` reads GPU time, which production doesn't have). **Review:** below the refresh rate the interval alone can't tell a slow GPU from a cap: the max FPS limiter (a 30 cap on 144 Hz would read as a GPU at 33 ms), the browser throttling rAF (iOS Low Power Mode, battery saver, an embed's iframe), a display changed since measuring (the refresh rate isn't in the fingerprint). So:
  - **The interval compared with** is the longer of the display's refresh interval and the limiter's (`loopState.maxFPSInterval`).
  - **The GPU-busy marker:** every 4th rendered frame, the probe's `end` marks the GPU's queue (WebGPU `queue.onSubmittedWorkDone()` setting a flag; WebGL2 a `fenceSync`, three's `renderer.backend.device` / `.gl`, as `_dbg__GPUTimer.ts` reaches the backend), and the next frame's `begin` reads whether that work had finished. Every 4th: a marker allocates (a promise or a sync object). It matters only below the refresh rate, where frames are long, so a late `onSubmittedWorkDone` doesn't mislead it.
  - **The classes:** `REFRESH` (p50 interval ≤ 1.1 × the compared interval: the device holds it, which says nothing about how far above), `GPU` (below it with at least half the marked frames beginning busy: the interval is the GPU's frame time, Phase 2's lesson: on a tiler only the interval is), `CPU` (below it, the GPU not busy, p50 CPU time ≥ 0.5 × the interval) or `CAPPED` (below it, neither busy: a cap the engine doesn't know). Only a `GPU` window compares with the prediction.
- **D5 The comparison:** the ratio = the p50 interval ÷ the reference frame's predicted time at the window's drawing buffer pixels (`estimateFps`' frame), from the measured (uncorrected) benchmark. It's a property of the scene and the device together: the reference frame is meant to stand for the app's typical heavy scene (Hub page, "Debugging"), so a scene heavier than it rightly rates the device lower *for this app*. On a display without variable refresh a GPU-bound frame waits for the next refresh (17 ms shows at 33), so the ratio can err high up to 2×: accepted (the interval is what the player sees) and said on the Hub page.
- **D6 Only lowering:** a window over 1.25 (`observe.slowerThan`, "clearly below") gives a correction, the largest ratio of the stored windows. A `REFRESH` window never raises the prediction: a light scene holding the refresh rate proves nothing for a heavier one. **Review:** each scene keeps its *slowest* window, not its latest: the reference frame stands for `HIGH` settings and the scene runs at the app's own, so once the app follows a suggestion (shadows, PostFX) the scene gets lighter, and a latest window would relax the correction and raise the settings again on the next boot. The correction only grows until a new measuring or "Clear observations". `observe.sceneIds` keeps a test or stress scene (the example app's `instanceStress`) from lowering the device for the whole app. The correction divides the GPU benchmark's throughputs before scoring, so `estimatedFps`, the GPU's headroom and level, and the solved pixel ratio all follow from one place (`scoreDeviceCapabilities`, a scaled copy of `benchmark.gpu`); the measured throughputs stay as measured.
- **D7 Storage:** `measurements.observed?: DeviceObservation[]` (optional, so a stored result of version 2 reads as none: no version bump): the slowest `GPU` window per scene id (8 scenes at most, the oldest dropped), each raw: `{ sceneId, at, frames, p50FrameMs, p95FrameMs, p50CpuMs, gpuBusyShare, comparedIntervalMs, pixelWidth, pixelHeight, limitedBy }`. **Review:** no stored ratio (§4: only raw measurements are stored; a ratio goes stale when an app update changes `referenceFrame`): the scoring computes each window's ratio against the measured benchmark and the current reference frame, and "slowest" is compared at storing with the current targets. Stored with the measurements (`saveToLS`), so a later boot starts corrected; a new measuring (`force`, a fingerprint change, `maxAgeDays`) drops them. `REFRESH`, `CPU` and `CAPPED` windows aren't stored (the debug tab shows the last one).
- **D8 Telling the app:** a window that changes the correction re-scores the report (`_setDeviceCapabilityReport`) with `report.isSuggestionLowered: true` when a level or the recommendations went down (a required boolean, false on every other report; **review:** was `levelSuggestionChanged`, against the `is` / `has` rule), so a listener offers lower settings; nothing is applied. `verdict.observedCorrection` (the factor, null without one) says why. A forced level (the debug tab) still wins over the corrected one.
- **D9 Debug:** the Device capabilities tab gains an Observation folder (the observer's state: waiting, warming up, measuring n / 300, the last window of each kind with its classification and ratio, the stored ones, the correction; a "Clear observations" button), and the profiler's Device level row's detail names a correction ("observed ×1.4").

**Sections** (review after each):

1. **The sampling:** `addFrameProbe` in `MainLoop.ts` (the profiler moved to it; the loop state to `end`), `DeviceObservation.ts` (the window's statistics, the classifier, the ratio; tests with fake frames), `DeviceObserver.ts` (the probe, the GPU-busy marker, the scene and visibility hooks, D3's rules, the windows; started by the check when `observe.enabled`), `DeviceObserveConfig` on `AppConfig.deviceCapabilities`. Checked by logging the windows in a running scene (no scoring yet).
2. **The correction:** `measurements.observed`, storing the slowest window per scene (D7), the correction in the scoring (D6; `DeviceScoring.test.ts` cases: none, under 1.25, a slow scene lowering the level and the pixel ratio, a forced level over it), `isSuggestionLowered` and `observedCorrection` (D8), the report re-scored and the listeners called. Tests in `DeviceCapabilities.test.ts` with a fake observer.
3. **Debug, app and docs:** D9's folder and row; the example app turns `observe` on (`src/CONFIG.ts`, `sceneIds` its three game-like scenes: `thirdPersonGymScene`, `terrainShowcase`, `largeWorld`); the Hub page's sections (how it works, the event to offer lower settings, with a snippet), the readme bullet, the CHANGELOG entry (Phases 1-4; the engine's 6.26.0 and the app's 1.35.0 are already the branch's bumps), `yarn verify:baselines --update`, `yarn build`. Then mark the plan done (`_DONE_` rename, its references) and say it's time for the PR into `main`.

As built (section 1):

- **The frame probes** (`MainLoop.ts`): `addFrameProbe(probe)` returns its remover; the list is replaced on a change, never changed in place, so a probe removed during a frame doesn't shift the walk; without one a frame costs two length checks. `FrameProbe` (`@internal` now) `end(now, rendered, loopState)` gets the loop's own state object. The profiler's `_dbg__FrameProbe.ts` adds its probe on the first hold and removes it on the last.
- **`DeviceObservation.ts`** (pure, tested): `summarizeObservationFrames` (nearest-rank p50 / p95 of the window's own frames, rounded to µs; sorts copies once a window), `readComparedIntervalMs(refreshHz, maxFPSInterval)`, `classifyObservation` (D4's order: `REFRESH`, `GPU` on the marks, `CPU` at half the interval, else `CAPPED`; without marks never `GPU`), `readObservedOverPredicted` (D5, rounded to 0.01). The prediction's time is `predictFrameMs` in `DeviceScoring.ts`, which `estimateFps` now rounds.
- **`DeviceObserver.ts`** (tested with a fake env, `DeviceObserverEnv`, the engine's in `readEngineObserverEnv()`, as the probe's `DeviceProbeEnv`): `startDeviceObserver(options, env?)` → `{ hold, getProgress, stop }`. Defaults `DEFAULT_OBSERVE_WARM_UP_MS` 5000, `DEFAULT_OBSERVE_FRAMES` 300 (clamped 30-2000). The warm-up and the scene's `sceneIds` match start at the first rendered frame after a `loadSettled` (or the start). The window's drawing buffer is the canvas's `width` / `height`. A limiter-skipped frame's CPU time goes to the next rendered frame's, as the profiler's. The marks: every 4th window frame; WebGPU's keeps the newest resolved mark's id, so an older mark resolving late never stands for a newer one; WebGL2's fence is deleted when read or broken. `getProgress().state` is `WAITING` (frames left out, or the scene not observed), `WARMING_UP` or `MEASURING`.
- **The check** (`DeviceCapabilities.ts`): after a report with a GPU benchmark and `observe.enabled`, it `import()`s the observer once (not awaited: a failed load is warned), and holds it while the benchmark measures (`observer.hold()`). Section 1's `onWindow` logs each window in the debug env with its ratio; section 2 replaces it.
- **Checked** (the Windows Chrome 157 on the RX 7900 XT, 144 Hz, from WSL2 through `devTools/verify/browser.ts`; the observer started from the page with 120-frame windows): `terrainShowcase` at 1280×720 is `REFRESH` (p50 6.945 ms, busy share 0-0.1) on both backends; at 3840×2160 × 2 (33 MP) it's `GPU` (busy share 1 on WebGPU, 0.86-1 on WebGL2): WebGPU p50 14.1-16.9 ms against a predicted ~11.3 (ratio 1.26-1.5, fill 54.7), WebGL2 11.1-12.1 ms (ratio 1.19-1.3, fill 66.1). WSL2's headless Chromium on SwiftShader paces frames at ~500 ms with gaps over 1 s even in `sceneTestECS`, so its windows break on the gap rule: a device that slow observes nothing (it rates `LOW` anyway). `CAPPED` was checked in the tests only: a browser throttling the page's frames (iOS Low Power Mode, battery saver) wasn't at hand.

**Verification:** the unit tests; in a browser, a GPU-bound window and its correction. The 7900 XT holds 144 Hz in every app scene at its window's size, so force one: the terrain showcase at a raised pixel ratio, or a target resolution the reference frame underpredicts (a `referenceFrame` lighter than the scene in `CONFIG.ts`, which gives a ratio over 1.25 on purpose). SwiftShader (`--webgl`, WSL2) is GPU-bound in every scene, so it runs the whole path too. A light scene at the refresh rate gives `REFRESH` and changes nothing.

---

## 7. Risks

1. **GPU memory target is heuristic only.** Browsers expose no VRAM figure. Expect `UNKNOWN` on most discrete-GPU and non-Apple devices. Mitigation: explicit `UNKNOWN` + `unknownIs`. Don't build gameplay-critical decisions on this target.
2. **System memory is Chromium-only and capped at 8 GB.** `minDeviceMemoryGB` above 8 can never pass. The scorer clamps the target to 8 and warns once.
3. **FPS is a prediction** from a synthetic workload (§1.2). It is only as good as the `referenceFrame` calibration. Thermal throttling, battery-saver modes (eg. iOS Low Power Mode caps rAF at 30) and background load at measuring time can produce a pessimistic stored result. Mitigations: `maxAgeDays`, fingerprint invalidation, `force` re-runs from the settings UI, and Phase 4.
4. **First-boot delay** of up to `budgetMs` (default 1.5 s) before any engine UI exists. Later boots cost one `requestAdapter()`.
5. **Two GPU devices briefly coexist** when the check runs at runtime. The benchmark device is destroyed right after. The main loop is paused so the two don't contend.
6. **Browser variance**: `GPUAdapter.info` is intentionally coarse or empty in some browsers (privacy), and `WEBGL_debug_renderer_info` is masked in Firefox/Safari. This weakens the fingerprint and the integrated/unified-memory heuristics, not the benchmark.
7. **Level thresholds are a judgement call.** The default bands are only as good as the Phase 2 calibration. They're overridable (`levelThresholds`), and the debug forced levels make every path testable regardless.

---

## 8. Files

New:

- `src/_engine/kernel/deviceCapabilities/DeviceCapabilities.ts`: public API, cache, listeners, the debug registration
- `src/_engine/kernel/deviceCapabilities/DeviceCapabilitiesTypes.ts`
- `src/_engine/kernel/deviceCapabilities/DeviceProbe.ts`
- `src/_engine/kernel/deviceCapabilities/DeviceScoring.ts`
- `src/_engine/kernel/deviceCapabilities/GpuBenchmark.ts`, `CpuBenchmark.ts` (dynamically imported)
- `src/_engine/kernel/deviceCapabilities/debug/_dbg__DeviceCapabilities.ts`
- `src/_engine/kernel/deviceCapabilities/DeviceCapabilityReports.ts` (Phase 3: the last report and its listeners, apart from the check)
- `src/_engine/kernel/deviceCapabilities/DeviceObservation.ts`, `DeviceObserver.ts` (Phase 4)
- a `*.test.ts` next to each module with logic

Changed:

- `src/_engine/schemas/_HelperSchemas.ts`: `QualityLevelSchema`/`QualityLevel`, `ShadowQualitySchema` alias (§3.1)
- `src/_engine/kernel/config/Config.ts`: `AppConfig.deviceCapabilities`, defaults, tab order id
- `src/_engine/kernel/init/Boot.ts`: the `runAtInit` hook, debug tab registration
- `src/_engine/index.ts`: the API's exports
- `src/CONFIG.ts`, `src/index.ts`: example usage (Phase 3)
- the profiler's GPU memory budget and Overview row (`debug/gpuMemory/`, `debug/profiler/`, Phase 3)
- `hub/pages/`, `readme.md`, the root `.claude/CLAUDE.md` (the kernel's folder list)
- `package.json` versions, `CHANGELOG.md`

Reused:

- `lsGetItem`/`lsSetItem`/`lsRemoveItem` (`utils/LocalAndSessionStorage.ts`)
- `toggleMainPlay`/`getReadOnlyLoopState` (`kernel/loop/MainLoop.ts`)
- The `LOW`…`ULTRA` scale of `ShadowQualitySchema`/`ShadowQuality` (`schemas/_HelperSchemas.ts`) and `SHADOW_PRESETS` (`kernel/light/Light.ts`)
- `PhysicsWorkerTarget` (`features/physics/types/PhysicsConfigTypes.ts`, `import type` only: the kernel names a feature's types, never its code)
- `createDebuggerTab`/`debuggerListCMP` (`debug/DebuggerGUI.ts`), the UI kit's table and fields (`aekasha/ui`)
- `loadDebugModuleAsync` (`kernel/config/DebugModules.ts`)
- `llog`/`lwarn` (`utils/Logger.ts`)

---

## 9. Verification

- `yarn lint`, `yarn test` and `yarn build` pass. `yarn sbp` (or `dist-stats/bundle-stats.html`): with `runAtInit: false` and no app import, no DeviceCapabilities code is in the first download; `yarn verify:baselines` shows only the new chunks and API names. On a cache hit, the benchmark chunks are not requested (Network tab).
- `yarn dev` with `runAtInit: true`:
  - The first load logs a report and writes `AEK_deviceCapabilities`.
  - A reload uses the cache (`fromCache: true`, no benchmark).
  - Changing `targets` in `CONFIG.ts` re-scores without re-measuring.
  - Bumping `reportVersion` or clearing via the debug tab re-measures.
- Chrome DevTools rendering emulation / `forceWebGL`: the WebGL2 path produces a report. A browser with no WebGPU gives `api: 'WEBGL2'` and a `webgpu` check result that follows `requireWebGPU`.
- Firefox and Safari: memory and GPU memory checks read `UNKNOWN`, and `meetsTargets` follows `unknownIs`.
- Levels:
  - With the benchmark off, `gpu`/`cpu` come from `HEURISTIC`/`API` and never reach `ULTRA` via the heuristic.
  - `overall` equals the lowest known category, and a capped 8 GB memory reading doesn't lower it.
  - `minLevels: { overall: 'ULTRA' }` fails on a mid-range machine.
  - A forced `LOW` in the debug tab changes `recommendations.shadowQuality` to `LOW`.
  - `yarn gatherAppData` still produces an unchanged light/sky box JSON schema after the `ShadowQualitySchema` alias.
- Runtime call from the console / debug tab while a scene runs: the loop pauses and resumes in its previous state, and no GPU device is left alive (no WebGPU warnings, no FPS drop afterwards).
- Phase 2 calibration table: the default reference frame's predicted GPU time is within 25 % of the game-like scenes' observed time on the calibration machines, or over it (conservative). `sceneTestECS` is too light to calibrate on (Phase 2's As built).
