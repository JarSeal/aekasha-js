Status: stub — not-implemented
Category: Gameplay, Cameras, Cutscenes
Related: `src/_engine/features/character/CLAUDE.md` (the brain contract and `setCharacterBrain` in code, which a takeover uses), p420_npc-simulation-tiers.md (The gameplay contracts: C7, the sequencer and splines; C4, the brain switch on takeover), p425_game-events-missions-and-save-games.md (cues emit game events), \_DONE_p083_editor-creator-view.md (an editor view to draw splines in), `src/_engine/ui/CLAUDE.md` (the UI kit's curve editor, in its forms)

# Sequencer, Splines and Cutscenes — Stub

**This is a stub.** The gameplay contracts (p420) leave the sequencer and splines as a direction
(C7). This plan decides their shapes.

## Goal

- **Splines:** a spline asset type in the scene JSON (`*.spline.json`), drawn and edited in the
  debug tools, used as paths for actors, cameras and anything else that follows a curve.
- **Sequencer:** timelines with tracks that drive actors (through a `SCRIPT` brain), cameras (camera
  rails), and cues (game events, p425).
- **Cutscenes:** a timeline that takes over actors and the camera and hands them back.

## The direction it starts from (the gameplay contracts)

- An actor in a cutscene keeps its controller; the sequencer switches its brain to `SCRIPT` and
  restores the previous one at the end (C4's brain switching). A cutscene that has to look exact
  can switch the controller too (kinematic, p421).
- Simulation tracks advance by the step clock; camera and presentation tracks can run at frame time.

## Grounding (2026-11-04)

- No spline, curve or path code in `src/` (no `CatmullRomCurve3` or `CurvePath` use).
- The UI kit's curve editor on `aekasha/ui` (`ui/forms/curve/`, p804 D8): `createCurveEditor`
  with `evaluateCurve` and `getCurvePreset`: a y-of-x curve, a CSS
  `cubic-bezier` easing or cubic Hermite keys with tangents (falloff and animation curves), not
  a path. `evaluateCurve` scans the keys per call (fine at a few dozen); sorted keys and a binary
  search are this plan's call if a track evaluates many.
- Cameras: the kernel's cameras (`kernel/camera/Camera.ts`), the toolkit's follow camera rig
  (`createFollowObjectCameraRig`, `src/toolkit/ecs/gameplay/FollowObjectCameraRig.ts`) and the
  debug camera (`kernel/camera/debug/`). A camera rail is a new rig, in the toolkit next to it.
- The asset pipeline (`gatherAppData`, `GATHERED_SUFFIXES`; Zod schemas in `src/_engine/schemas/`
  or next to their feature; `devTools/gather/CLAUDE.md`) is where a new asset type is added.
- Lines to draw a spline with: the `lines()` feature (`createLines`, `features/lines/`).

## Open questions

1. **Spline representation:** Catmull-Rom, Bézier or both; arc-length parameterisation for constant
   speed; closed loops.
2. **Editing:** in the Runtime view with the debug camera, or an editor view of its own
   (`src/_engine/debug/editors/CLAUDE.md`); points edited with the on-screen tools, values in the
   UI kit's property grid; written back through the dev files (`writeDevFiles`,
   `devTools/devFiles/CLAUDE.md`).
3. **Timeline authoring:** a data asset (`*.sequence.json`) with a timeline editor, or code first.
4. **Skipping and saving mid-cutscene:** what state a skip jumps to, and whether a save during one is
   allowed.
5. **Determinism:** whether cutscenes are part of the probe's hash (actors under `SCRIPT` brains
   move by the step clock, so they can be).
