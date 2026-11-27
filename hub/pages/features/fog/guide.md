## Installing it

List [`fog()`](api:fog), from `aekasha/fog`, in `InitEngine`'s `features` (see
[How the app starts](hub:examples/quick-start#how-the-app-starts)); the template lists it right
after `rainOcclusion()`, so it runs after the sky box each frame and reads this frame's sky. The
engine's features don't import each other, so the app ties the fog to its sky with two sources:

```ts
import * as THREE from 'three/webgpu';
import { InitEngine } from 'aekasha';
import { fog, setFogColorSource, setFogSunSource } from 'aekasha/fog';
import { getSkyHorizonColor, getSunDirection, skyBox } from 'aekasha/skybox';
import { appData } from './generated';

InitEngine({
  data: appData,
  features: [
    skyBox(),
    fog(),
    {
      id: 'app',
      install: () => {
        // The fog takes the sky's horizon colour away from the sun...
        setFogColorSource((out) => getSkyHorizonColor(out) !== null);
        // ...and glows toward the sky's horizon on the sun's side
        const sunHorizon = { direction: new THREE.Vector3() }; // read every frame: no allocation
        setFogSunSource((direction, color) => {
          if (!getSunDirection(direction)) return false;
          sunHorizon.direction.copy(direction);
          return getSkyHorizonColor(color, sunHorizon) !== null;
        });
      },
    },
  ],
  start: async () => {},
});
```

The fog is in the template app's first download, {{sbp:app.group:_engine/features/fog}}; its
debug tab loads only in a debug build. Without `fog()`, the getters return `null`, the setters
throw naming the feature, and a scene whose JSON lists `fogs` fails the boot (see
[the feature manifest](hub:features/scenes-and-assets#the-feature-manifest)).

## A scene's fogs

A fog is a `*.fog.json` (its id the file's name unless it gives one) or the same object inline in
the scene JSON. A scene lists its fogs in `fogs`, like its `skyboxes`, and starts with the one
marked `isDefault` (else the first). This is the showcase's height fog:

<<< src/app/scenes/fogShowcase/fogShowcaseHeight.fog.json

```json
"fogs": ["fogShowcaseLinear", "fogShowcaseExp2", "fogShowcaseHeight"]
```

Every mode's parameters can sit in one fog at once, so switching `mode` loses none of them; only
`mode` says which renders. Every key but `mode` has a default:

| Key             | What it is                                                                                                    | Default            |
| --------------- | ------------------------------------------------------------------------------------------------------------- | ------------------ |
| `mode`          | `LINEAR`, `EXP2` or `HEIGHT` (below)                                                                          | required           |
| `enabled`       | Whether this fog renders                                                                                      | `true`             |
| `colorSource`   | `SKY`: the colour the app's source gives (the sky's). `MANUAL`: `color`                                       | `SKY`              |
| `color`         | `MANUAL`'s colour, and `SKY`'s when no source is set or the sky gives none (sRGB)                             | `#b4c0cc`          |
| `linear`        | `near` and `far`, metres from the camera                                                                      | 10, 500            |
| `exp2`          | `density`                                                                                                     | 0.005              |
| `height`        | `density` (per metre at `baseHeight`), `baseHeight`, `falloff` (per metre), `startDistance`, `maxOpacity`     | 0.02, 0, 0.1, 0, 1 |
| `sunScattering` | The sun glow: `enabled`, `strength` (0-1), `exponent` (higher is tighter)                                     | by mode, 0.5, 8    |
| `background`    | `FOG_COLOR`: while no sky box shows a background, the clear colour is the fog's, so the far fog fades into it | `NONE`             |

The gather resolves each fog with its defaults when it reads it, `sunScattering.enabled` from its
mode: on for `HEIGHT`, off for `LINEAR` and `EXP2`, which then look like three's own fog. A fog's
`__saveData` holds a scene's edits, as other shared assets do
([per-scene overrides](hub:features/scenes-and-assets#per-scene-overrides)).

## The modes

- **`LINEAR`** is three's `Fog`: none before `near`, full past `far`, a smoothstep between, over
  the view depth.
- **`EXP2`** is three's `FogExp2`: `1 − exp(−(density · depth)²)`, clear near the camera and
  closing in fast past `1 / density`.
- **`HEIGHT`** is an exponential height fog: its density is `density` at `baseHeight` and falls
  by `exp(−falloff · metres above it)`, so it pools in the valleys and thins over the hills. The
  fog factor is that density integrated along the ray from the camera to the pixel, in closed
  form (`1 − exp(−∫)`), from `startDistance` on and at most `maxOpacity`. A camera inside the fog
  sees it thicken around it; one above looks down into it. It measures the ray's length, where
  `LINEAR` and `EXP2` take the view depth, so it's a little thicker toward the screen's edges.

What a density means in metres: an `EXP2` fog of 0.004 hides a quarter at 140 m and three
quarters at 300 m; the showcase's `HEIGHT` fog (0.01 at the lake's level, `falloff` 0.15) fogs
the valley floor about 70 % at 300 m and leaves the 50 m hilltops clear.

Why not a raymarched volumetric fog: it needs the scene's depth (a second render of the scene
with MSAA on), a march per pixel and a filter, milliseconds a phone or an embedded scene can't
pay. What most scenes want from it, the height falloff and the bright side toward the sun, the
height fog gives in every material for a few arithmetic operations a pixel.

## The colour and the sun glow

**The fog's colour** is the sky's by default (`colorSource: 'SKY'`): each frame the fog asks the
source the app set with [`setFogColorSource`](api:setFogColorSource), and takes its `color` when
there's none or it returns `false`. The template's source is the sky box's
[`getSkyHorizonColor`](api:getSkyHorizonColor), the sky's colour at the horizon away from the
sun, computed on the CPU from the same terms the sky's shader composes: measured against the
rendered sky through the `DAY_NIGHT` cycle, dusk and dawn included, the two agree to within float
precision there. Both are linear and before tone mapping, like the fog, so the far fog
meets the sky's horizon band. `MANUAL` takes `color` instead, for a fog of a colour of its own
(smoke, a green swamp).

**The sun glow** (`sunScattering`, in every mode) moves the fog's colour toward the sun's around
it: by `strength · max(cos θ, 0)^exponent`, θ the angle between the view and the sun. The fog
glows toward the sun and keeps the horizon's colour away from it. It changes the colour, not how
thick the fog is. The sun comes from [`setFogSunSource`](api:setFogSunSource): its direction and
the colour to glow toward. The template's is the sky box's sun and the sky's own horizon colour
on its side, which goes orange at sunset and dark at night by itself and never outshines the sky
behind it; a light's colour × its intensity would. Without a sun there's no glow.

## Changing it from code

```ts
import { onFogChange, setFog, setFogEnabled, updateFog } from 'aekasha/fog';

// Another of the scene's fogs, or one made in code, or none
setFog('valleyMorning');
setFog({
  id: 'smoke',
  mode: 'EXP2',
  colorSource: 'MANUAL',
  color: '#3a3430',
  exp2: { density: 0.04 },
});
setFog(null);

// The valley fills with fog over the next minute
updateFog({ height: { density: 0.08, falloff: 0.35 } }, { transitionSec: 60 });

// A graphics setting: the whole fog off, in every scene
setFogEnabled(false);

const removeListener = onFogChange((fog, reason) => console.log(reason, fog?.id));
```

- [`setFog(idOrDefinition | null)`](api:setFog) shows one of the current scene's `fogs` by its
  id, a definition made in code (resolved with the defaults like a file's) or none. A scene's
  exit clears it, and the next scene starts with its own default.
- [`updateFog(values, { transitionSec })`](api:updateFog) changes any of the fog's values but its
  id, at once or moving each number and the colour linearly (the colour in linear space). The
  latest call wins per value: one made while a value moves starts again from where it is, and
  the values it doesn't change keep moving. `mode`, `enabled`, `colorSource` and `background`
  switch at once, and switching the sun glow fades it. [`getFog()`](api:getFog) returns the new
  values at once; only what renders moves. The time is the main loop's, as the sky's clouds
  drift: it stops with the engine's pause and in an editor view, scales with the play speed, and
  stands still while a scene loads. The scene's data isn't changed, so the
  next visit starts from its JSON. This is what a weather system drives.
- [`setFogEnabled`](api:setFogEnabled) and [`isFogEnabled`](api:isFogEnabled) switch the whole
  fog, whichever shows, kept across scenes; a fog's own `enabled` switches only that fog.
- [`onFogChange`](api:onFogChange) hears `'set'`, `'update'` (once a call, not while the values
  move), `'enabled'` and `'clear'`, and returns its remover.

The fog is for the look: it runs on frame time, not on the physics steps, and isn't saved with a
game; a game that saves its weather sets the fog from it.

## What it costs

**One graph, never recompiled.** The fog is the root scene's `fogNode`: one TSL graph over
uniforms made once a page load, holding all three modes' factors weighted by the current mode and
the sun glow. The engine writes the uniforms in place, so switching the mode, the glow, a fog or
the master switch, and every transition, costs a uniform write. Each material pays its few
arithmetic operations a pixel. A scene without fogs has no fog node; the first fog a scene that
started without one shows from code compiles each material once more.

**Its uniforms are shared by every draw** (three's render group, as its own fog's are): a classic
material such as `MeshStandardMaterial` refreshes its own per-object uniforms only when it or its
object changes, so a uniform a scene-wide node reads per object would stay at its first frame's
value there.

## What it fogs

- **Every material of the root scene**, in linear HDR before tone mapping, transparent and
  additive ones included (toward the fog's colour, as three's fog does). A material that
  shouldn't be (a glow) sets `fog = false`. A material with its own `outputNode` replaces the
  fogged colour; one with a `fragmentNode` is fogged.
- **Not the sky:** the background is never fogged, so geometry against the sky keeps its
  silhouette. `background: 'FOG_COLOR'` fills the clear colour with the fog's when there's no sky
  box.
- **Not the debug helpers:** the 3D symbols, the light and camera helpers, the physics wireframes
  and the debug lines go through `markDebugHelper`, which sets `fog = false` on them. Bakes,
  shadow maps and the rain occlusion map aren't fogged either.
- **Only the root scene:** a viewport's own scene, snapshots' and bakes' scenes have no fog. A
  viewport that should show it takes the same node, which follows the root scene's fog:

  ```ts
  import { getFogNodes } from 'aekasha/fog';

  const fogNodes = getFogNodes();
  if (fogNodes) myViewportScene.fogNode = fogNodes.node;
  ```

- **Impostors** are fogged at their billboard's depth, not their per-pixel depth: the error is the
  billboard's depth spread.
- **The PostFX ambient occlusion** runs after the materials' fog, so it darkens fogged distance;
  fade the AO pass out with distance where it shows.

[`getFogNodes()`](api:getFogNodes) also gives each uniform and the fog factor alone
([`FogNodes`](api:FogNodes)), for a material of your own that reads the fog.

## Debugging

- **The debug drawer's Fog tab:** the scene's fogs (and none), the master switch, the fog's
  `enabled` and mode (only its parameters shown), the colour's source with the sky's live colour
  (switching to `MANUAL` starts from it), the sun glow with the sun's colour, the background, and
  Copy JSON. Edits go through undo and are kept in the browser per scene and fog until the Æ
  menu's Save writes them into the fog's `.fog.json` as the scene's `__saveData` entry (an inline
  fog moves into a file in the scene's folder). A fog made in code shows its edits but keeps none.
- **The fog factor view** (the tab's View section) shows the factor in grey in the fog's place:
  black clear, white full fog. It recompiles the materials, which is fine in the debugger.
- **The showcase** (`?isDebug=true&startScene=fogShowcase`): its tab switches the three fogs, sets
  the hour and plays the day (the colour following the sky), and fills the valley with a dense
  fog over 4 s and lifts it again.

## Key APIs

- [`fog`](api:fog): the feature.
- [`setFog`](api:setFog), [`getFog`](api:getFog), [`updateFog`](api:updateFog),
  [`setFogEnabled`](api:setFogEnabled), [`isFogEnabled`](api:isFogEnabled) and
  [`onFogChange`](api:onFogChange): the fog showing.
- [`setFogColorSource`](api:setFogColorSource) and [`setFogSunSource`](api:setFogSunSource): the
  sky it follows; [`getSkyHorizonColor`](api:getSkyHorizonColor) (`aekasha/skybox`): the sky's
  colour at the horizon.
- [`getFogNodes`](api:getFogNodes): the graph and its uniforms.
- [`FogDef`](api:FogDef): a fog with every key filled in.

## Read more

- [Sky box](hub:features/sky-box): the sky the fog follows, its day-night cycle and sun.
- [Surface conditions](hub:features/surface-conditions): the weather on the ground, the other
  half of a weather system.
- The API reference: [`aekasha/fog`](hub:documentation/aekasha/fog).

::: claude-md
:::
