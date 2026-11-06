**Title:** A build that imports no model still ships three's animation classes in its first download

Status: open
Category: Smallest build, Assets
Found: 2026-10-15, p613 Phase 3 (D4: the glTF import path behind an `import()`)
Our workaround: none needed for correctness; it costs the banner embed about 2 KiB gzip before its first frame

## What happens

p613 D4 moved the glTF import path (`kernel/assets/import/ImportRegistry.ts` and what it imports)
out of the initial chunk: `SceneDataLoader.ts` imports it only for a scene whose data names an
imported asset. The banner embed's first download went from 300.4 to 287.3 KiB gzip, not to the
285.1 KiB that p611's scratch build measured with the import path removed outright.

The difference is three's own code. The lazy `ImportRegistry.js` chunk still names three's
`GLTFLoader`, whose animation classes (`KeyframeTrack`, `PropertyBinding`, `Interpolant`, …) live
in `three.core.js`. That module is in the initial chunk (the renderer needs it), and Rollup keeps
a used export where its module is, so those classes ship before the first frame in every build,
also one whose scenes import nothing (the banner's `three` group is the same 623,028 B before and
after D4).

## A way out

Only a build that names no import path at all drops them. For an SBP profile whose scenes import
no model (the gatherer knows: no scene's data names an `importedAssets` entry), a build-time
constant from the profile's data could fold the `import()` in `loadSceneImportsAsync` away
(`devTools/sbp/` builds the profile; the engine reads a `define` like `__AEK_DEBUG__`). The
entry's `importAssetAsync` still imports the registry statically for an app that calls it, so
such a profile must not call it either: the build would then keep the classes, which is correct.

Measure it with `yarn sbp --profile banner` against the committed baseline.

## three r187 (checked 2026-11-05, p057)

Unchanged: `Interpolant`, `KeyframeTrack`, `AnimationClip`, `PropertyBinding` and `AnimationMixer`
are still in `build/three.core.js`, which the first download needs, and #34619 only drops maths
classes nothing uses. The banner's `three` group shrank anyway (251.7 → 231.1 kB gzip, `three/tsl`
made tree-shakeable, #34533), so the byte figures above need measuring again. The same mechanism
now applies to TSL: a TSL function only a lazy chunk uses still lives in `three.tsl.js`, which
`three.webgpu.js` imports statically, so it ships in the first download.
