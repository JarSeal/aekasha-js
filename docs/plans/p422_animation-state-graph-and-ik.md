Status: stub — not-implemented
Category: Characters, Animation
Related: `src/_engine/features/character/CLAUDE.md` (the actor and controller contracts in code: the locomotion state, the controller's `state`), p420_npc-simulation-tiers.md (The gameplay contracts: C6, which this plan decides), p421_kinematic-character-controller.md (both controllers report the same locomotion states), p250_physics-api-support-for-multibody-joints.md (ragdoll joints), p420_npc-simulation-tiers.md (cheaper animation per tier, `CROWD` vertex animation), p510_headless-simulation-runtime.md (The multiplayer path: root motion and determinism; a server runs no three)

# Animation State Graph and IK — Stub

**This is a stub.** C6 (p420's The gameplay contracts) is a direction, not a contract: it waits for
the first animated character. This plan is where it gets decided and built, against a real rigged
model.

## Goal

An `ANIMATION` component with a state graph (states, transitions on the locomotion state and the
intent, blend spaces) driving three's `AnimationMixer`, then IK layers (foot placement on the floor
ray, look-at, hand targets). Ragdoll as a controller mode plus jointed bodies.

## The direction it starts from (C6)

- Presentation side: runs at `APP_RENDER_SYNC`, in the `POSE_CONSUMERS` slot (after the
  interpolated pose, where the follow camera rig and the character gizmos are).
- It reads the simulation and never writes it. Root motion that moves the body is the exception
  this plan decides (§ Open questions 1).
- Ragdoll: `CharacterControlMode`'s `PHYSICS_ONLY` exists with the getting-up path back (the
  documented hand-off: a ragdoll switches the character to it, drives the joints and hands control
  back through getting up); the jointed bodies are p250's.

## Grounding (2026-11-04)

- No `AnimationMixer` and no `SkinnedMesh` in engine, toolkit or app code (only the profiler census
  and the LOD window recognise skinned meshes). Three's keyframe and binding classes already ship
  in every build (`docs/issues/three-animation-classes-in-builds-without-models.md`), so `yarn sbp`
  measures what a mixer and the graph add; the feature loads its own code on first use.
- `LocomotionState` (10 states, `features/character/CharacterTypes.ts`) is documented as "what a
  future animation-state system switches on", with `onLocomotionStateChange`; its listeners run
  inside the sub-step. A graph reads the controller's `state.locomotionState` at `APP_RENDER_SYNC`
  instead.
- The character's visual can be any `Object3D`; the controller never reads it.
- LOD cross-fades skip skinned meshes (`_DONE_p351`), and impostors are static.

## Open questions

1. **Root motion and determinism** (the contracts' risk 2): animation-driven movement in a
   deterministic simulation means the graph (or its root-motion track) runs per step in the
   simulation, and so on a headless server without three (p510). Most networked games keep root
   motion off for remote actors.
2. **Authoring:** the graph as data (a `*.animGraph.json` asset type, gathered and validated: a
   schema next to the feature and its `GATHERED_SUFFIXES` entry, `devTools/gather/CLAUDE.md`) or as
   code first; a debug tab or window on the UI kit (its graphs and property grid) to watch and
   force states.
3. **IK:** three's `CCDIKSolver`, a two-bone solver of our own, or a library; how foot placement
   reads the floor ray (`CharacterController.probes`) without a cast of its own.
4. **Cost per tier** (p420): update rate by distance (Unreal's URO), and vertex animation textures
   for `CROWD`.
5. **Retargeting** between rigs, and the first rigged model the toolkit ships.
