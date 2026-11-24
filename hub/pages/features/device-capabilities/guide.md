## Running the check

Turn it on in the app's config, and the boot runs it before anything else installs, so the report
is ready when your `start` callback runs:

<<< src/CONFIG.ts#device-capabilities

The example app passes the suggested pixel ratio to the renderer:

<<< src/index.ts#create-renderer

- **[`getDeviceCapabilityReport`](api:getDeviceCapabilityReport)** returns the last report, or
  null before a check has run. A check that fails at the boot is warned and the boot goes on
  without a report, so read it with `?.`.
- **From code,** [`runDeviceCapabilityCheckAsync`](api:runDeviceCapabilityCheckAsync) runs it at
  any time: a "Test my device" button in a settings menu, or a first check where your app decides
  when. Calls that overlap share one check.
- **[`onDeviceCapabilityReport`](api:onDeviceCapabilityReport)** calls you with every new report
  and returns its remover.

```ts
import { evaluateDeviceCapabilities, runDeviceCapabilityCheckAsync } from 'aekasha';

// A settings menu's "Test my device": measures again, with a progress bar
const report = await runDeviceCapabilityCheckAsync({
  force: true,
  onProgress: (phase, progress01) => progressBar.setValue(progress01 * 100),
});

// Would the device hold the "Ultra" preset? Scored again, nothing measured
const canRunUltra = evaluateDeviceCapabilities({ minLevels: { gpu: 'ULTRA' } })?.meetsTargets;
```

## What it costs

- **The first boot** waits for the benchmark, about 1.5 s (`benchmark.budgetMs`), before the
  engine shows anything: your page's own loading screen covers it.
- **Later boots** use the stored result (see [The stored result](#the-stored-result)): one
  adapter request to recognise the device, and the benchmark's code isn't even downloaded.
- **An app that never asks** runs nothing and downloads nothing. `runAtInit` loads the check as a
  chunk of its own, and the benchmark, most of its code, loads only when it measures
  ([Smallest build possible](hub:features/smallest-build)).
- **A check while a scene runs** pauses the main loop while it measures, so the game's frames
  don't share the GPU with the benchmark, and plays it again after (`pauseMainLoop: false` keeps
  it going).

## What it measures

- **What the browser tells:** the WebGPU adapter (its vendor and architecture, features, limits)
  and the WebGL 2 fallback's, the logical cores, the system memory (Chromium only), the screen and
  its pixel ratio, HDR, whether the page is cross-origin isolated (physics' shared buffer needs
  it) and whether it's a touch device.
- **What it guesses:** no browser tells the GPU's memory. An Apple silicon or integrated GPU gets
  a share of the system memory; a discrete GPU is unknown.
- **What it benchmarks:** the GPU's fill rate and triangle rate, on a GPU device of its own at the
  target resolution, on the API the renderer would use; one CPU core's speed (matrix multiplies);
  the display's refresh rate. A page that's hidden meanwhile waits, and a run that stalled isn't
  kept.
- **The frame rate it predicts** is for a **reference frame**: a stand-in for your scenes, in the
  benchmark's units (`targets.referenceFrame`). The default stands for the example app's
  game-like scenes (high shadows, ambient occlusion, half a million triangles). An app with
  lighter or heavier scenes tunes it (see [Debugging](#debugging)). The prediction is only as
  good as that frame, so treat it as an estimate.

## Levels

Each category gets a level, the highest whose threshold it meets, and the device's **overall**
level is the lowest of the known ones: the weakest part is the bottleneck. They're the shadow
presets' scale, so a level can be a light's `shadowPreset` as it is.

| Category | Rated by | `MEDIUM` | `HIGH` | `ULTRA` |
| --- | --- | --- | --- | --- |
| GPU | the predicted frame rate ÷ the target's, at the target resolution | 0.5 | 1 | 2 |
| CPU | the lower of the cores' and the benchmark score's level | 4 cores, 6000 | 6, 12000 | 12, 20000 |
| Memory | the system memory, GB | 4 | 8 | 16 |
| GPU memory | the guess, MB | 1024 | 2048 | 4096 |

- Under `MEDIUM`'s threshold is `LOW`. `levelThresholds` in the config replaces any of them.
- **The GPU depends on the resolution:** the same GPU rates lower on a 4K display than at 1080p.
  The level says what the device can run there, not how fast the chip is. Holding the reference
  frame at the target frame rate is `HIGH`.
- **Without the benchmark** (`benchmark.enabled: false`) the GPU is rated by its adapter (never
  `ULTRA`) and the CPU by its cores.
- **An unknown category** (no memory reading, no GPU memory guess) is `null` and doesn't lower
  the overall level; neither does a memory reading of exactly 8 GB, the most older browsers
  report. `levels.sources` says how each level was decided.

## Targets and the verdict

The report's `verdict` checks the device against **targets**: the engine's defaults, the
config's `targets` over them, then a check's own `targets` over those.

| Target | Default | Checked against |
| --- | --- | --- |
| `fps` | 60 | the predicted frame rate, at most the display's refresh rate (a 60 Hz display never fails a 120 target) |
| `resolution` | `'CANVAS'` | the canvas's size × the pixel ratio, or `{ width, height }` |
| `minDeviceMemoryGB` | 4 | the system memory |
| `minGPUMemoryMB` | 2048 | the GPU memory guess |
| `minCpuCores` | 4 | the logical cores |
| `requireWebGPU` | false | a WebGPU adapter |
| `requiredGPUFeatures` | `[]` | the adapter's features |
| `minLevels` | `{}` | the levels, eg. `{ overall: 'MEDIUM', gpu: 'HIGH' }` |

- Each check is `PASS`, `FAIL` or `UNKNOWN` (the browser doesn't tell), and `unknownIs` (default
  `'PASS'`) decides whether an unknown one fails `meetsTargets`: otherwise Firefox and Safari
  would fail every memory target.
- `failedTargets` names the checks that didn't pass, for a message to the player.
- [`evaluateDeviceCapabilities`](api:evaluateDeviceCapabilities) scores the last measurements
  against other targets, without measuring: a settings menu can ask it about each preset.

## Recommendations

`verdict.recommendations` suggests settings from the levels. Nothing applies them: pass what you
want where it goes.

- `pixelRatio`: the largest of the device's own, 2, 1.75 … 0.5 at which the predicted frame rate
  holds the target, for [`createRenderer`](api:createRenderer)'s `devicePixelRatio`.
- `antialias`: on from a `HIGH` GPU, for `createRenderer`.
- `shadowQuality`: the lower of the GPU's and the GPU memory's levels, for a light's or the sky
  box sun's `shadowPreset` (`ULTRA`'s 4096² maps need the memory).
- `postFx`: on from a `MEDIUM` GPU, for [`setPostFxEnabled`](api:setPostFxEnabled).
- `renderBackend`: WebGL 2 without WebGPU or on a software adapter (`createRenderer`'s
  `forceWebGL`).
- `physicsWorkerTarget`: the main thread on a `LOW` CPU. Physics reads its target from the config
  when it installs, after the boot's check, so keep the choice for the next boot.

The levels go further than these: the GPU's for the LOD bias and the density of instances, the
CPU's for physics sub-steps and entity counts, the memory's for texture sizes and the streaming
radius.

## The stored result

- With `saveToLS` (the default) the measurements are stored in the browser's localStorage
  (`AEK_deviceCapabilities`): only the raw measurements, never the verdict, so new targets in a
  new version of your app need no new measuring.
- A stored result is used while it's the same measuring version, the same device (the browser,
  the GPU, the screen and its pixel ratio, the cores) and younger than `maxAgeDays` (30; 0 keeps
  it). A new GPU, a browser update or another monitor measures again.
- [`clearStoredDeviceCapabilityReport`](api:clearStoredDeviceCapabilityReport) removes it, so the
  next check measures; `force: true` measures without removing it.
- The readings are fingerprinting-grade data. The engine never sends them anywhere: an app that
  uploads them for telemetry has to handle them so.

## Debugging

In the debug env the drawer's **Device capabilities** tab shows the last report: the levels next
to the device's own, the target checks with their results, the recommendations and every
measurement. Its buttons run the check, measure again and clear the stored result.

- **Forced levels:** the tab's selects force a category's level, or the overall one, for this
  browser. The report then gives the forced levels and the recommendations they make (its
  listeners hear it), so you can test your app's `LOW` path on a strong machine. The measured
  figures stay, and a production build has none of it.
- **The profiler** shows the device's level as an Overview row, and the GPU memory tab's budget
  follows the device's GPU memory level until you set one.
- **Calibrating the reference frame:** the tab's Calibration folder measures the running scene at
  three pixel ratios and logs what it fits. Only a scene that holds the GPU busy (its frame rate
  under the refresh rate) compares with the benchmark: on a strong GPU, a heavier scene or a
  higher pixel ratio.

## Key APIs

- [`runDeviceCapabilityCheckAsync`](api:runDeviceCapabilityCheckAsync),
  [`getDeviceCapabilityReport`](api:getDeviceCapabilityReport),
  [`onDeviceCapabilityReport`](api:onDeviceCapabilityReport),
  [`evaluateDeviceCapabilities`](api:evaluateDeviceCapabilities) and
  [`clearStoredDeviceCapabilityReport`](api:clearStoredDeviceCapabilityReport).
- [`DeviceCapabilitiesConfig`](api:DeviceCapabilitiesConfig) (`AppConfig.deviceCapabilities`),
  [`DeviceCapabilityTargets`](api:DeviceCapabilityTargets) and
  [`DeviceCapabilityReport`](api:DeviceCapabilityReport).
- [`QualityLevel`](api:QualityLevel), [`compareQualityLevels`](api:compareQualityLevels) and
  [`minQualityLevel`](api:minQualityLevel): the `LOW` to `ULTRA` scale.

## Read more

- [Rendering](hub:features/rendering#the-renderer): the renderer the recommendations are for.
- The API reference: [`deviceCapabilities/`](hub:documentation/aekasha/deviceCapabilities) of
  `aekasha`.
