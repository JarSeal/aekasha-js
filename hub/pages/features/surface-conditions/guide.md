## Installing it

List [`surfaceConditions()`](api:surfaceConditions), from `aekasha/surface`, in `InitEngine`'s
`features`, right after `skyBox()` (see
[How the app starts](hub:examples/quick-start#how-the-app-starts)), and
[`rainOcclusion()`](api:rainOcclusion) right after it if anything should shelter the ground from
the rain. The template lists both. Without `surfaceConditions()`, the getters return `null`, the
setters throw naming the feature, a wet material builds dry (warned once), and a scene whose JSON
sets `surfaceConditions` fails the boot (see
[the feature manifest](hub:features/scenes-and-assets#the-feature-manifest)).

```ts
import { InitEngine } from 'aekasha';
import { getSunElevation, skyBox } from 'aekasha/skybox';
import { rainOcclusion, setSurfaceSunSource, surfaceConditions } from 'aekasha/surface';
import { appData } from './generated';

InitEngine({
  data: appData,
  features: [
    skyBox(),
    surfaceConditions(),
    rainOcclusion(),
    {
      id: 'app',
      // Surfaces dry fastest under a high sun and slowest at night
      install: () => setSurfaceSunSource(() => getSunElevation()),
    },
  ],
  start: async () => {},
});
```

Both features are in the template app's first download, {{sbp:app.group:_engine/features/surface}}
together; their debug tab loads only in a debug build. An app that lists neither carries none of
it.

## The state

| Field          | What it is                                                                               | Default     |
| -------------- | ---------------------------------------------------------------------------------------- | ----------- |
| `wetness`      | 0..1, how wet the ground is                                                              | 0           |
| `rain`         | 0..1, how hard it rains: it wets the ground, rings the puddles and runs down steep faces | 0           |
| `puddleLevel`  | 0..1, how full the puddles are                                                           | 0           |
| `waterLevel`   | The world Y of a lake's or the sea's surface, for a shoreline; `null` for none           | `null`      |
| `snowCoverage` | 0..1, how much of the ground snow covers                                                 | 0           |
| `temperature`  | °C: snow melts above 0, slush up to 3, frost below 0                                     | 15          |
| `dryingRate`   | How much wetness dries a minute in full sun and still air                                | 0.1         |
| `wind`         | `[x, z]` in m/s: wind dries faster                                                       | `[0, 0]`    |
| `mode`         | `SIMULATED`: the engine moves the values. `MANUAL`: only your code does                  | `SIMULATED` |

[`getSurfaceConditions()`](api:getSurfaceConditions) returns the live state (read-only), so game
code can ask whether the road is wet or the lake frozen.

## Setting the weather

```ts
import { setSurfaceConditions, startRain, stopRain } from 'aekasha/surface';

// A shower: 10 s to full rain, 90 s of it, then 10 s back to none
startRain(1, { rampSec: 10, durationSec: 90 });

// Or by hand: rain now, stop it later
startRain(0.6, { rampSec: 5 });
stopRain({ rampSec: 20 });

// A cold front over two minutes, then snow
setSurfaceConditions({ temperature: -6 }, { transitionSec: 120 });
setSurfaceConditions({ snowCoverage: 0.8 }, { transitionSec: 60 });
```

- [`setSurfaceConditions(values, { transitionSec })`](api:setSurfaceConditions) sets any fields;
  with `transitionSec`, each number moves there linearly. Setting a value while it moves starts
  again from where it is, and the simulation leaves a moving value alone. `mode` and switching the
  water level on or off happen at once. Out-of-range values are clamped.
- [`startRain(intensity, { rampSec, durationSec })`](api:startRain) ramps the rain up, and with
  `durationSec` ramps it down again by itself; [`stopRain({ rampSec })`](api:stopRain) ramps it
  to none.

## In a scene's JSON

A scene's `surfaceConditions` are its starting values. Every scene starts from the defaults with
its own values over them, before its scene code runs (which can set its own), so it looks the same
on every visit:

```json
"surfaceConditions": { "mode": "MANUAL", "wetness": 0.6, "puddleLevel": 0.6, "waterLevel": 0.15 }
```

## The simulation

In `SIMULATED` mode, every frame and measured in minutes of the surface clock:

- **Rain wets** at its intensity: full rain takes dry ground to soaked in about a minute.
- **The ground dries** at `dryingRate`, × the sun, × the wind, and not while it rains. The sun
  factor is the sine of the sun's elevation, at least 0.2 (night still dries a little), and the
  wind's 1 in still air to 3 at 20 m/s.
- **Puddles lag behind:** they fill toward the wetness at half its speed and drain at half the
  drying, so they're still there after the ground has dried.
- **Snow melts** above 0 °C, 0.02 of the cover a minute per degree, and all of it becomes wetness.

**The sun** comes from a function you give
[`setSurfaceSunSource`](api:setSurfaceSunSource) (the elevation in radians, or `null` without a
sun): the engine's features don't depend on each other, so the app ties the drying to its sky. The
template gives it the sky box's [`getSunElevation`](api:getSunElevation), as above.

**The surface clock** ([`getSurfaceTime()`](api:getSurfaceTime)) times the simulation and the
moving parts of wet materials: the rain rings, the water running down the streaks, the waves on a
shore. It's measured in seconds and stops while a scene loads. It restarts at every scene, so a
scene looks the same on every visit and in the scene runner's snapshots. With the feature's
`timeSource: 'APP'` (the default) it stops when the app loop is paused, with `'MAIN'` only when
the whole engine is.

The state is for the look: it runs at frame time, not on the physics steps, so it isn't
deterministic. Gameplay that depends on the weather (less grip on a wet road) needs its own state
advanced by the physics steps.

## Materials that read it

[`getSurfaceConditionNodes()`](api:getSurfaceConditionNodes) returns the state as TSL uniforms,
made on the first call and the same objects after, so a material binds them once when it's built
and follows the weather for good. Without the feature it returns `null`: build the material dry.

```ts
import { mix } from 'three/tsl';
import { getSurfaceConditionNodes } from 'aekasha/surface';

const nodes = getSurfaceConditionNodes();
// Darker as it gets wetter
if (nodes) material.colorNode = mix(dryColor, dryColor.mul(0.6), nodes.wetness);
```

The toolkit does the whole wet response for you: the terrain material's `wet` key, structure
materials, and [`applySurfaceWetness`](api:applySurfaceWetness) for a TSL material of your own,
each driven by these uniforms and each texture set's own response to water
([Terrain: wet and dry surfaces](hub:features/terrain#wet-and-dry-surfaces)).

## The rain occlusion map

Rain reaches what faces the sky, so a wet material keeps overhangs and undersides dry by their
facing alone. What it can't see is a roof, a tree or a bridge above it. `rainOcclusion()` renders a
depth map looking straight down, centred on the camera, and
[`getRainOcclusionNode()`](api:getRainOcclusionNode) gives a material how sheltered each point is
(0 open sky, 1 under cover); the terrain material's `wet: { rainOcclusion: 'MAP' }` uses it, so
there's no wetness, no puddle, no ripple and no snow under cover.

| Option         | What it is                                                                     | Default |
| -------------- | ------------------------------------------------------------------------------ | ------- |
| `size`         | Texels a side, 16–4096                                                         | 512     |
| `extent`       | Metres a side, around the camera                                               | 64      |
| `height`       | Metres above and below the camera it covers                                    | 100     |
| `updateFrames` | Frames between renders; 0 only when the camera moves or on a request           | 30      |
| `bias`         | Metres a surface may lie below the map's depth and still be open (its own top) | 0.05    |

- **Occluders** are the objects that cast shadows. `userData.rainOccluder` overrides it per object:
  `true` for a roof that casts no shadow, `false` for a glass canopy that should let the rain
  through.
- **It renders** once a material reads it, then when the camera has moved an eighth of the map,
  every `updateFrames` frames, and after
  [`requestRainOcclusionUpdate()`](api:requestRainOcclusionUpdate) (a door that just closed).
  [`setRainOcclusionEnabled(false)`](api:setRainOcclusionEnabled) turns it off: every surface
  reads open sky and nothing renders.
- **What it costs** (the gallery: a 512² map over 64 m, three occluders, measured rendering every
  frame on an AMD RDNA 3 GPU in Chrome): 0.26 ms of CPU a render and 0.005 ms of GPU; at the default
  of every 30 frames, about 0.01 ms of CPU a frame. The CPU part grows with the scene's object
  count, not the occluders'. Memory: 1.25 MiB at 512². A material pays one texture fetch a pixel.
- **Sample it outside a dynamic branch** (`If`) in your own TSL: a comparison sample needs uniform
  control flow.
- **The rain falls straight down:** the map isn't tilted by the wind.

## Debugging

- **The debug drawer's Surface conditions tab:** buttons for a rain shower (10 s up, 60 s, 10 s
  down), stopping the rain, drying and soaking at once, and a snowfall; every value and the mode;
  the surface clock and the sun's and the wind's drying factors. With `rainOcclusion()`, the map's
  switch, frames between renders, its status and its render's CPU and GPU time.
- **The gallery's Wet/dry row** (above): `?isDebug=true&startScene=terrainGallery`, its tab's
  "Wet/dry row" section. The terrain material's `WETNESS` view shows the wet response's stages and
  `TAPS` its texture fetches ([Terrain's debugging](hub:features/terrain#debugging)).

## Key APIs

- [`surfaceConditions`](api:surfaceConditions) and [`rainOcclusion`](api:rainOcclusion): the
  features.
- [`getSurfaceConditions`](api:getSurfaceConditions),
  [`setSurfaceConditions`](api:setSurfaceConditions), [`startRain`](api:startRain) and
  [`stopRain`](api:stopRain): the weather.
- [`getSurfaceConditionNodes`](api:getSurfaceConditionNodes) and
  [`getSurfaceTime`](api:getSurfaceTime): what materials read;
  [`setSurfaceSunSource`](api:setSurfaceSunSource): the drying's sun.
- [`getRainOcclusionNode`](api:getRainOcclusionNode),
  [`setRainOcclusionEnabled`](api:setRainOcclusionEnabled),
  [`isRainOcclusionEnabled`](api:isRainOcclusionEnabled) and
  [`requestRainOcclusionUpdate`](api:requestRainOcclusionUpdate): the map.
- [`applySurfaceWetness`](api:applySurfaceWetness) (`aekasha/toolkit/terrain`): the wet response.

## Read more

- The handbook's [Wet and dry surfaces](repo:docs/techniques/wet-dry-surfaces.md): what water does
  to a surface, every part's cost, the material's `wet` keys and each texture set's response, the
  regional wetness painted in Blender, the variations for each kind of game, and the pitfalls.
- [Terrain](hub:features/terrain#wet-and-dry-surfaces): the terrain material's wet response.
- The API reference: [`aekasha/surface`](hub:documentation/aekasha/surface).

::: claude-md
:::
