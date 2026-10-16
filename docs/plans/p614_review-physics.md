Status: draft | not-implemented
Category: Refactoring, Documentation, Physics
Epic: p600_whole-codebase-refactoring-and-documentation.md (Stage C)
Blocks: p621_hub-docs-readme-and-claude-md-final.md, p511_network-transport-and-replication.md (the transport interface)
Related: \_DONE_p613_review-rendering-scene-assets.md (D13: `MeshUserData.ts` and its bug; owns nothing here now), \_DONE_p612_review-ecs-loop-config-init.md (D2's type-only seams, D7's main-camera id), \_DONE_p611_sbp-tooling-profiles-and-marketing.md ("From p611" below), p500_restore-physics-snapshot.md (the snapshot code: moved as is, D12), p428_character-determinism-in-worker-targets.md (the protocol side of its choice: D5), p622_engine-6-major.md (what this plan can't remove in a minor: D3), p618_review-debug-public-api.md (owns the physics `_dbg__` modules)

# Review: Physics

Applies p600 §5 (the per-file review standard) and p605's JSDoc style to every file in scope,
records the findings per file group, and fixes them or files them. It also splits the three
largest files of the engine, puts the transport interface in front of `postMessage` (p604 §4.5,
for p511), gives `physics()` a stop for `mountAekasha`'s `unmount()`, fixes the bugs below, and
lands p613 D13 (the collider derivation of imported nodes).

## 1. As found (2026-10-16, branch `review-physics` at `3d0d098`, = `main` after p613's merge, Engine 5.4.0)

### 1.1 The stub's names, checked

The stub was written before p608's move and before p612 / p613 changed the files.

| Stub | Now |
| --- | --- |
| `PhysicsAPI.ts` 4,481 lines, `RigidBodyProxyAPI` ~985 | `features/physics/PhysicsAPI.ts` **4,542**. `WorldProxyAPI` ~540 (`:2411`), `RigidBodyProxyAPI` ~1,000 (`:2965`), `ColliderProxyAPI` ~400 (`:3965`), `JointProxyAPI` ~160 (`:4368`); `stepPhysics` ~190 (`:358`, over the 150-line limit too) |
| `PhysicsAPITypes.ts` 3,212 | **3,175**. The protocol (`PhysicsUpProtocol` `:2104` to the end, ~1,070 lines) is one block already, with ~100 `*Response` aliases (`:2837-2973`) |
| `EngineRapier.ts` 2,612, **`step` ~517 lines** | `backends/rapier/EngineRapier.ts` **2,620**, and `step` is **7 lines** (`:1168`). The large parts are the proxy classes: `EngineWorldProxyAPI` ~490 (`:1175`), `EngineRigidBodyProxyAPI` ~490 (`:1688`), `EngineColliderProxyAPI` ~340 (`:2175`), `EngineJointProxyAPI` ~110 (`:2511`) |
| "the physics manager" | `PhysicsEntity.ts` (993 lines; p608 renamed it). Three comments still say `PhysicsManager`: `PhysicsAPI.ts:267`, `:799`, `toolkit/ecs/effects/MutualGravity.ts:132` |
| "raycast" | `kernel/render/Raycast.ts` (295) and `RayDebugTypes.ts` (48): three.js raycasting, given to this plan by p613 §1.1 |
| "the `RayCastOpts` aliases (due in a major, this epic's)" | `Raycast.ts:40-50`, six `@deprecated` fields with no removal version. The epic's major shipped in Stage B (Engine 5.0.0); Stage C bumps are minor or patch (p600 §11), and every other deprecation says engine 6.0.0. D3 |
| `core/Physics` 65 / 221 documented | `features/physics/**` **182 / 354 exports** (§1.3) |

In scope (D1): `features/physics/` without `debug/` (17 modules and a test, 13.3k lines),
`kernel/render/Raycast.ts`, `RayDebugTypes.ts`, `kernel/mesh/MeshUserData.ts` (moved here, D13),
and four items in `features/character/` (§1.2).

### 1.2 The stub's inputs, checked

- **p604 §4.5's transport:** `worker.postMessage` at `PhysicsAPI.ts:849` and `:860`,
  `self.postMessage` at `PhysicsWorker.ts:331-337` and `:463`, `self.addEventListener` at `:315`.
  `initWorker` (`kernel/loop/Workers.ts`, shared with the assets worker) does the handshake. D5.
- **p428:** its choice (controller in the worker, or fixed-lag step-stamped reads) is its own;
  the transport mustn't rule either out. D5.
- **p500:** the snapshot code (`takePhysicsSnapshot` / `restorePhysicsSnapshot`, `PhysicsAPI.ts:1444-1484`;
  `EngineRapier.ts:1070-1078`, which reads the static `Rapier` import and never frees the old
  world; the `@CHORE`s on `WorldAPI`'s snapshot members, `PhysicsAPITypes.ts:1375-1383`) moves
  as is. D12.
- **p605 Phase 5's `notExported`:** the four still there. The `create*` functions return the
  classes, which aren't exported. D8.
- **p612 D2:** the kernel's `import type`s of physics' types stay; `ECSWorld`'s physics members
  stay public. Nothing to do here.
- **p612 D7:** `PhysicsTierPolicy.ts:324` still queries `TAG_IS_MAIN_CAMERA` per pass (`readCameraFocus`).
- **p612 Phase 7:** `CharacterTypes.ts:140`'s `{@link getBodyKind}` (the file doesn't import it).
- **p613 Phase 8:** `KindSpec` (`ActorTypes.ts:100`) and `PlayerBrainCommonActions`
  (`brains/PlayerBrains.ts:25`) aren't exported; `CharacterBrainKinds` (`ActorTypes.ts:80`) is
  exported but probably not on the entry (Phase 7 confirms with `yarn hub:build`).
- **p613 D13:** as p613 described (`MeshUserData.ts:58-146`: no `break` after `CAPSULE` and
  `CONE`; it writes `radius` / `halfHeight` / `orientation`, `PhysicsEntity.ts:64`'s reader reads
  `height` / `radiusTop` / `radiusBottom`). Its only importer is
  `features/physics/import/MeshColliderGeometry.ts:4`; `ThreeVector3` has no other user outside
  `ThreeMath.ts`. **One more half of it** (M2 below): `ColliderParams.orientation`
  (`PhysicsAPITypes.ts:1200`, "do not set manually … defined by the custom property") is set by
  nothing, so an imported node's `spineAxis` never reaches its collider.
- **p611:** `unmount()` doesn't stop the physics worker (`Mount.ts:157`); `FeatureContext` has no
  teardown hook. D6. The tiers as a feature of their own: D3.
- **The sync queries' allocations** (p610 Phase 4's `perf-auditor`): still there, `new RAPIER.Ray`
  per `castRayAndGetNormalSync` (`EngineRapier.ts:1503`) and `paramsToShape` per `castShapeSync`
  (`:1424`). The wall cast reuses one `ShapeParams` and changes its `halfHeight` / `radius`
  (`controllers/dynamic/Wall.ts:83-84`), so a cache keyed by object identity would be wrong. D11.
- **Found by p605 for p614:** `EngineRapier.ts:556` sets friction only when truthy, so
  `friction: 0` is ignored and the collider keeps Rapier's 0.5. **Eight template colliders ask
  for 0** (`scene01.ts:65`, `:102`; `thirdPersonGymScene.ts:382`, `:467`, `:500`, `:540`, `:579`,
  `:618`), so the fix changes those scenes. D4.

### 1.3 Documentation (the ratchet's `docs.json`)

| File | Exports undocumented | Members undocumented |
| --- | ---: | ---: |
| `PhysicsAPITypes.ts` | 126 (~100 of them `*Response` aliases) | 8 |
| `EngineRapier.ts` | 19 | — |
| `PhysicsAPI.ts` | 8 | 2 |
| `PhysicsUtils.ts` | 8 | — |
| `worker/PhysicsSwitch*.ts` | 4 | — |
| `PhysicsEntity.ts`, `PhysicsTierPolicy.ts` | 2 each | — |
| `PhysicsDebugStateBuffer.ts` | — | 8 |
| `PhysicsTransformBuffer.ts` | — | 7 |
| `Engines.ts`, `PhysicsStepStatsBuffer.ts`, `PhysicsTierTypes.ts` | 1 each | — |

172 exports and 25 members; `import/` is at 3 / 3. `Raycast.ts` and `RayDebugTypes.ts` have none
undocumented, but use the pre-p605 `@param x (type) text` form throughout (as do
`PhysicsAPI.ts`' ray stats and `PhysicsEntity.ts:687`).

### 1.4 Findings by file group

Numbered for the phases. **(bug)** marks wrong behaviour, **(SBP)** bytes, **(perf)** per-frame
cost; the rest are hygiene, placement and API shape. Read from the code, not reproduced, unless a
finding says so.

**The facade (`PhysicsAPI.ts`)**

- A1 **(bug)** A worker request that fails never settles. The worker answers a throw with
  `ERROR` and the request's `requestId` (`PhysicsWorker.ts:304-311`), but `onWorkerMessage` only
  logs an `ERROR` (`PhysicsAPI.ts:884-887`), and `messageWorkerAsync` creates its resolver without
  a `reject` (`:859`). So the caller's promise stays pending forever, and a `createPhysicsEntity`
  whose worker create throws (a missing TRIMESH index, `paramsToShape`'s throws) hangs
  `settlePendingPhysicsEntities` and with it the scene load. `messageWorkerAsync` also rejects
  with a string, not an `Error`. The assets API already does this right (`AssetsAPI.ts:190-297`:
  `rejectRequest`, and every pending request rejected when the worker dies).
- A2 **(bug)** `createRigidBodies` posts its params as they are (`:1557`), without
  `toWireRigidBodyParams`: a `THREE.Quaternion` rotation reaches the worker without x/y/z/w
  (`toPlainRot`'s comment, `:811`). `createJoint` (`:2264`) has the same gap for a `FIXED`
  joint's `frame1` / `frame2`. `createRigidBody`, the colliders and the proxies' setters convert.
- A3 **(bug)** `WorldProxyAPI.contactPairsWith` returns at `if (!coll1Id)` (`:2882`): collider 0
  (the page's first collider, ids are never reused) gets no contact pairs in `WORKER_THREAD` mode.
  `intersectionPairsWith` checks `=== undefined`. The worker side has the same bug (W1).
- A4 Deletes disagree on a stale or unknown id. `deleteRigidBody` and `deleteColliders` are quiet
  no-ops without a world (CLAUDE.md: "Deleting one is a quiet no-op"); `deleteRigidBodySync`,
  `deleteRigidBodies(Sync)`, `deleteCollider(Sync)`, `deleteCollidersSync`, `deleteJoint(Sync)`
  throw (`existsOrThrow(physicsWorldEnabled)`). `WorldProxyAPI.removeRigidBody` / `removeCollider` /
  `removeJoint` (`:2673-2686`) drop the promise, so such a throw is an unhandled rejection.
  `deleteColliders`' error names "rigid bodies" (`:2204`, `:2237`).
- A5 Duplication: every create and delete is written four times (async and sync × the two
  targets), each with a "Should not get here" throw, and `WorldProxyAPI`'s `create*Sync` keeps a
  `MAIN_THREAD` branch the class never runs in (it's the worker proxy). This is most of the
  file's length, and what the split (D7) removes.
- A6 Stale docs: `initPhysics` calls `WORKER_THREAD` "not-yet-exercised" (`:288-292`; it's the
  default); `holdPhysicsStepping` and `resetPhysicsWorld` name `SceneLoader.ts` (physics' scene
  hooks call them since p607); the two `PhysicsManager` comments.
- A7 **(perf)** `stepPhysics` in `WORKER_THREAD` mode allocates the `substepCommands` array and
  one capture array per sub-step every frame, also when no system issued a command; a captured
  command is `structuredClone`d (needed: callers reuse scratch vectors).
- A8 API shape: 8 undocumented exports (`createPhysicsWorld`, `deletePhysicsWorld`, `getRigidBody`,
  `getCollider`, `getJoint`, `isPhysicsSteppingHeld`, `takePhysicsSnapshot`, `restorePhysicsSnapshot`),
  and the facade's internals that the debug tab reads are exported without `@internal`
  (`getAllRigidBodyEntries`, `getResolvedTransportMode`, `setPhysicsDebugStateTracking`, …).
  `WorldAPI`'s queries take 9-13 positional parameters: they mirror Rapier's, are documented as
  such, and stay (D3).
- A9 `ccdSubsteps: 1, // TODO` in `WorldProxyAPI`'s cache (`:2420`), `@CHORE: add isEnabled cache`
  (`:2968`), `@CONSIDER: should we throw` (`:885`; A1 answers it), the two snapshot `@TODO`s (p500's).

**The types (`PhysicsAPITypes.ts`)**

- T1 Placement: config, world, body, collider, joint, query, event and protocol types in one
  file; `EngineAPIType` (the backend contract) next to the public types.
- T2 Type hygiene: `PhysicsEngine = keyof typeof ENGINES`, and `ENGINES` is a
  `Record<string, …>` (`Engines.ts:6`), so it's `string`: `AppConfig.physics.physicsEngine`
  accepts any string.
- T3 The protocol's `*Response` aliases are internal plumbing counted as public API (D9).
- T4 A commented-out declaration kept as history (`:824`, "USED TO BE … remove this line at some
  point").

**The backend (`backends/rapier/EngineRapier.ts`, `backends/Engines.ts`, `PhysicsUtils.ts`)**

- R1 **(bug)** `if (params.friction)` (`:556`): `friction: 0` is ignored (§1.2). The other truthy
  checks (`restitution`, the damping, `dominance`, `softCcdDistance`, the shapes' dimensions) are
  harmless: their 0 is Rapier's default or not a valid shape.
- R2 **(bug)** The debug-env guards on three warnings are inverted (`if (!isDebugEnvironment)`,
  `:719`, `:979`, `:1014`): they warn only in production builds.
- R3 **(bug, minor)** `createCollider` writes `parentId` into the caller's params object (`:534`):
  on `MAIN_THREAD`, reusing one params object for a second collider carries the first's parent.
- R4 **(perf)** The sync queries' allocations (§1.2). Rapier builds its raw shape and raw vectors
  from the JS objects on every query anyway, so the saving is the JS objects only: measured in
  Phase 5 before and after.
- R5 **(perf)** `EngineRigidBodyProxyAPI`'s `pos` / `rot` / `linvel()` / `angvel()` each allocate
  (Rapier's getters return new objects), and the worker's write-back reads all four per body per
  STEP message (W3).
- R6 Duplicate defaults: `EngineRapier.ts:46-69` repeats `PhysicsAPI.ts`' `physicsState`
  defaults, which `init` replaces before anything reads them (p612 D4: one owner).
- R7 Hygiene: `@CHORE: needs a setter function` (`:45`), `NEW STUFF (@CHORE: delete this line
  when everything is diamonds!!!)` (`:71`), a half sentence at `:717`, three `@TODO: Make error
  handling better` (`:484-521`; A1 makes the throws reach the caller), 8 `no-explicit-any`
  (`:2374-2474`: the shape getters read Rapier's untyped shape fields), the `as unknown as`
  enum casts between Rapier's and the API's enums (`:876`, `:2023`, `:2037`, `:2367`).
- R8 `PhysicsUtils.ts`: `getColliderShapeName`, `getPhysicsEngineKey` and its own
  `setPhysicsPauseTime` have no caller (the facade has its own copy); `getEngineAPI`'s only use
  is a `JSON.stringify` in an error message. 8 undocumented exports.

**The worker (`worker/PhysicsWorker.ts`, `PhysicsSwitch{World,Rigid,Coll,Joint}.ts`)**

- W1 **(bug)** `WORLD_CONTACT_PAIRS_WITH` and `WORLD_INTERSECTION_PAIRS_WITH` push a pair only
  `if (coll2Id)` (`PhysicsSwitchWorld.ts:163`, `:172`): collider 0 is never anyone's pair.
- W2 Type hygiene: `sendMessage(message: any)` in the worker and three switches (file-wide
  `eslint-disable`s); only `physicsSwitchWorld` types its replies against `PhysicsDownProtocol`.
  A string thrown in the worker is upper-cased into the error message (`:294`).
- W3 **(perf)** `writeBackTransforms` walks every body per STEP message with four allocating reads
  (R5) and two map lookups; in `MESSAGE_BATCH` mode it then copies the whole buffer
  (`maxBodies` × 52 B = 106 kB at the default 2,048) per message. Measured in Phase 5.
- W4 Ordering: `handleMessage` is `async`, and only `INIT_PHYSICS` awaits real work (the WASM
  load). The facade awaits its reply before sending anything else, so nothing overlaps today; the
  transport's contract says so (D5).
- W5 `@CHORE: remove` on four `RIGID_*` cases (`PhysicsSwitchRigid.ts:221-283`): `translation`
  and `rotation` replies the proxy no longer sends (it reads the buffer). Checked and removed in
  Phase 4 if nothing sends them.
- W6 4 undocumented exports (the switches).

**Physics entities (`PhysicsEntity.ts`)**

- E1 **(bug)** `createPhysicsEntityNow` doesn't re-check after its `await` (`:293-303`): an entity
  deleted meanwhile (a scene exit's `deleteAllPhysicsEntities` while a `WORKER_THREAD` create is in
  flight) gets its components added back, and its body registered in `bodyOwners` and the facade's
  map, for a world `resetPhysicsWorld` replaces next. Phase 1 reproduces it in a test first.
- E2 Size: 993 lines; the render interpolation (`:537-993`, ~450 lines,
  `physicsInterpolationSystem` ~220) is its own module.
- E3 **(perf)** `physicsInterpolationSystem` reads `OBJECT3D` through `world.getComponent` per
  entity per frame (`:946`) instead of its storage once per frame.
- E4 API shape: `createPhysicsEntity` takes five positional parameters, three optional (the
  options-object rule), and has 53 callers in the app (D3). `getPhysicsEntityByAppId` (on the
  entry) is `getEntityIdByAppId` under another name and doesn't check the entity is a physics one.
  `disposePhysicsEntity` is exported and undocumented. `deriveColliderDimensionsFromMesh` belongs
  with the collider derivation (D13).
- E5 Stale: the comment names `Import/MeshColliderGeometry.ts` (now `import/`), and a warning
  points at `docs/plans/_DONE_p059_…md`, which no longer exists (`:790`).
- E6 Three copies of "the entity's body, also while `REMOVED`" (`PhysicsEntity.ts:385`,
  `PhysicsTiers.ts:49`, `PhysicsTierPolicy.ts:315`).

**Tiers and the tier policy (`PhysicsTiers.ts`, `PhysicsTierPolicy.ts`, `PhysicsTierTypes.ts`)**

- P1 p612 D7: `readCameraFocus` queries `TAG_IS_MAIN_CAMERA` per pass; `getMainAppCameraId()`
  reads the cached id for the default world (other worlds keep the query).
- P2 **(perf)** A `STEPS` pass (every `interval` steps) allocates: a `THREE.Vector3` for the focus,
  `position.clone()`, `[...members.keys()].sort()`, `filter`, the `bodyIds` array and a
  `Float32Array` per measurement on `MAIN_THREAD`. Small and every 10 steps by default; pooled
  where it's free to.
- P3 API shape: `getPhysicsTierPolicy`, `getPhysicsTierPolicyStatus`, `setPhysicsTierPolicyFrozen`,
  `isPhysicsTierPolicyFrozen`, `getPhysicsTierPolicyFreezeSources` are exported, not on the entry,
  and not `@internal` (their users are the debug tab and the probe). `DEFAULT_TIER_POLICY_*`
  undocumented. `PhysicsTiers.ts` and `PhysicsTierPolicy.ts` re-export their types next to the
  entry's.
- P4 `bodyHasJoints` walks every joint without stopping at the first hit (`PhysicsTiers.ts:54`).
- P5 Otherwise clean: the async replies are sequence-checked (`removalSeq`, `dropped`), the
  per-step state is reset per world (`simEpoch`), and requests apply on fixed steps.

**Collider derivation (`import/ImportPhysics.ts`, `import/MeshColliderGeometry.ts`, `kernel/mesh/MeshUserData.ts`)**

- M1 **(bug)** p613 D13's mismatch (§1.2): imported `CAPSULE`, `CONE` and `CYLINDER` colliders
  get the Physics API's default `halfHeight`, and a cone or cylinder no derived radius.
- M2 **(bug)** No importer turns `spineAxis` into `ColliderParams.orientation`, so an imported
  capsule or cylinder whose spine is X or Z stays Y-up.
- M3 **(bug)** A `HEIGHTFIELD` whose vertex count has no integer square root logs "importing
  failed" and then returns the params without `heights` (`MeshColliderGeometry.ts:123-128`), so
  `paramsToShape` throws (and, with A1, a `WORKER_THREAD` create hangs). It should return null
  (skip), as the two checks above it do.
- M4 `MeshUserData.ts` writes through the shared `ThreeVector3`, `new THREE.Vector3()` for the
  capsule only; the scratch mesh's geometry is never disposed (no GPU resources, so harmless).

**Ray casting (`kernel/render/Raycast.ts`, `RayDebugTypes.ts`)**

- C1 **(SBP)** `const raycaster = new THREE.Raycaster()` at module load (`:55`), and the kernel
  installs `Raycast.ts` (`installRaycast`), so every app's main chunk keeps `Raycaster` and `Ray`
  even when it never casts (p613's §7 list). Made on the first cast.
- C2 D3: the deprecated aliases get their removal version.
- C3 The `@param x (type)` form throughout; otherwise clean (one shared raycaster, `near` / `far`
  restored in a `finally`, allocation-free with `target`).

**Characters (the four items of §1.2)**: the `{@link getBodyKind}` and the three `notExported`.

**Across physics**

- X1 **`physics()` has no stop** (§1.2): `mountAekasha`'s `unmount()` leaves the worker, its world
  and the visibility listener (`onVisibilityChange(physicsVisibilityChangeHandler)`, whose remover
  is dropped) alive. D6.
- X2 No unit test covers the backend or the facade: the Rapier compat build runs in Node (p604
  ran the worker there), so Vitest can drive `EngineRapier.ts` directly.

## 2. Decisions (proposed 2026-10-16; confirm before Phase 1)

### D1. Scope: §1.1's files

`features/physics/` without `debug/` (p618 owns the `_dbg__` modules; this plan only fixes the
imports a split breaks in them), `Raycast.ts`, `RayDebugTypes.ts`, `MeshUserData.ts`, and the four
character items. The character controller and brains are p610's, done.

### D2. Versions

Engine **minor** (5.4.0 → 5.5.0): `unmount()` stops physics (D6, a behaviour change and a new
`FeatureContext` member), the bug fixes (D4: `friction: 0` changes two scenes), the deprecation
versions (D3), the tier policy's debug exports marked `@internal` (P3; not on the entry, so not a
break). Toolkit **patch** (`MutualGravity.ts`' comment). App **patch** only if D4's scene
baselines move with a scene change (they don't need one). Project = engine.

### D3. What waits for engine 6.0.0: a stub of its own

No plan owns 6.0.0, and this plan is a minor. A new stub, `p622_engine-6-major.md`, collects
every removal the engine's `@deprecated` tags promise for 6.0.0 (p610's character fields, p612's
`CoreComponentType`, p613's scene and texture deprecations, `getPhysGameTime` and
`PhysicsWallClock.ts`), plus this plan's:

- the six `RayCastOpts` aliases (this plan tags them "removed in engine 6.0.0");
- p611's `physicsTiers()` feature (the "From p611" analysis below moves there with it). Until
  then `physics()` stays as it is, as p611 advised for a major without it;
- `createPhysicsEntity`'s options object (E4): 53 callers and the readme's example, so a candidate
  for the major, not a minor's deprecation churn;
- `WorldAPI`'s positional queries (A8): they mirror Rapier's, and only a backend change (Jolt)
  would be a reason to reshape them.

### D4. The bugs are fixed first (Phase 1), each with a test

A1, A2, A3 / W1, A4's throws made quiet no-ops (with the error message fixed), R1, R2, R3, E1, M3.
M1 and M2 go with D13 (Phase 7).

**D4b, the one behaviour change:** R1's fix gives the eight `friction: 0` colliders of `scene01`
and `thirdPersonGymScene` the friction their code asks for. Their probe hashes and the gym's
character path hash change (the gym's platforms and carousels are among them, so the characters
on them move differently). **Recommended:** fix it, play the gym's moving platforms and carousels
by hand in both worker targets, and record the new baselines with the reason. The alternative,
writing 0.5 into those eight colliders to keep the hashes, encodes a value nobody chose.

### D5. The transport interface

`features/physics/transport/PhysicsTransport.ts` (`@internal` until p511 has a second
implementation; p604 §4.5's shape):

```ts
type PhysicsTransport<Out, In> = {
  send(message: Out, transfer?: Transferable[]): void;
  onMessage(fn: (message: In) => void): () => void;
  close(): void;
};
```

- Two implementations now: the main thread's (around the `Worker` from `initWorker`) and the
  worker's (around `self`). The facade's `messageWorker*` and the worker's `sendMessage*` go
  through them; nothing else calls `postMessage`.
- **Its contract** (written on the type): messages are plain data (no class instances, no
  functions; p604 §4.5), delivered in order, and a receiver handles one message to the end before
  the next (W4). A request's `requestId` reply or its `ERROR` settles it (A1); `close()` rejects
  every pending request, as the assets API does when its worker dies.
- **p428 isn't decided here:** both of its directions fit this shape (the first adds a message
  type; the second adds step stamps to `EVENTS_PUSH` records, a field). Neither is added now.
- Cost: one indirection per message (p604 §4's estimate); the scene runner's hashes don't move.

### D6. `physics()` gets a stop

`FeatureContext` gets `onUnmount(fn)` (the kernel's install contract, `kernel/init/Features.ts`;
`mountAekasha`'s `teardown` runs the hooks in reverse install order; `InitEngine` has no unmount,
so a full-page app never runs them). Physics' hook: release the stepping hold and the gates,
delete the world, close the transport (`terminate()` the worker, reject what's pending), and
remove the visibility listener. `Mount.ts:157`'s note and its Hub page say it's stopped.

### D7. The split: one module per area, each under ~800 lines

The proposed layout (exact names settle in their phase; no file outside `features/physics/`, so
`moveRules.ts` needs no new rule, but `moveMap.json` is regenerated):

- **Types** (`types/`): `PhysicsConfigTypes.ts` (`PhysicsState`, the target / mode / behaviour
  unions, `EngineAPIType`), `PhysicsBodyTypes.ts`, `PhysicsColliderTypes.ts` (shapes, enums),
  `PhysicsJointTypes.ts`, `PhysicsWorldTypes.ts` (`WorldAPI`, queries, events, hooks), and
  `protocol/PhysicsProtocol.ts` (the enum, `PhysicsUpProtocol` / `PhysicsDownProtocol`, the
  responses).
- **The facade:** `PhysicsState.ts` (state, `initPhysics`, the backend handle),
  `PhysicsStepping.ts` (`stepPhysics`, the accumulator, hold / pause / visibility, the step clock
  and stamps, gates, the limit, the latch), `PhysicsStepStats.ts`, `PhysicsQueryStats.ts`,
  `PhysicsMessaging.ts` (the transport's use, capture, pushes, events), `PhysicsRegistry.ts` (the
  three maps, the worker callbacks), `PhysicsWorld.ts` (create / delete / reset / flush /
  snapshots / debug tracking), `PhysicsBodies.ts`, `PhysicsColliders.ts`, `PhysicsJoints.ts`, and
  `proxies/` (the four worker proxy classes).
- **The backend** (`backends/rapier/`): `EngineRapier.ts` stays the module `Engines.ts` imports
  (the `EngineAPIType` object, assembled from) `RapierState.ts`, `RapierBodies.ts`,
  `RapierColliders.ts`, `RapierShapes.ts` (`paramsToShape` and D11's cache), `RapierJoints.ts`,
  `RapierEvents.ts` and `proxies/` (the four engine proxy classes).
- **The duplication goes with the split (A5):** one `isWorkerTarget()` branch per operation, the
  sync variants calling one shared body, no unreachable branches. `RigidBodyProxyAPI`'s ~60 RPC
  getters and their throwing `*Sync` twins get two helpers (a request for one field, and the
  "async in worker mode" throw), which is what brings it under 800 lines.
- **Kept:** every exported name and signature (the entry re-exports from the new modules), the
  message types and their numbers, system registration order (the installs don't move), and the
  worker bundle without three, `MainLoop`, `Config` or the facade (`PhysicsWorker.test.ts`).
- **Moved, not rewritten:** the snapshot code (D12), the interpolation maths (E2).

### D8. The `notExported` proxy types: the signatures name the interfaces

`createRigidBody` & co. are annotated to return `RigidBodyAPI` / `ColliderAPI` / `JointAPI`
(what callers use), so no class needs exporting. Same for the three character types: export
`KindSpec` and `PlayerBrainCommonActions` with a summary if the entry's types name them,
otherwise inline them (Phase 7 picks per type).

### D9. The protocol is `@internal`

The protocol module's types are `@internal` (the worker's and the facade's plumbing, not an app's
API); the ratchet counts an `@internal` block as documented (p605). The public types (`RigidBodyAPI`,
`ColliderAPI`, `JointAPI`, `WorldAPI`, the params and enums) get their summaries and members
documented: §1.3's 172 exports and 25 members reach 100%.

### D10. Tests

A backend test (`backends/rapier/*.test.ts`, Vitest in Node, the compat build's WASM): friction
0, collider 0's pairs, `createCollider` not writing the caller's params, the shape cache's
results equal to a fresh shape's. A facade test with a stub transport: an `ERROR` reply rejects,
`close()` rejects what's pending, `createRigidBodies` / `createJoint` send plain rotations. A
derivation test per shape (D13, p613's ask). E1's test drives `createPhysicsEntity` with a delayed
reply and a delete in between.

### D11. The sync queries reuse their Rapier objects

One `RAPIER.Ray` reused (origin and dir set per call), and one Rapier shape per shape type with
its dimensions set per call (Rapier reads them into a raw shape on every query; checked against
Rapier 0.19.3's `castShape` source in Phase 5). The worker's write-back reads into scratch arrays
(`readPoseInto` / `readVelocitiesInto`), and `MESSAGE_BATCH` copies only the live slots, if
Phase 5's measurements show the gain (R4, R5, W3).

### D12. p500's code moves as is

The snapshot functions, the static `Rapier` import in `restoreSnapshot` and their `@TODO` /
`@CHORE`s move into `PhysicsWorld.ts` / `RapierState.ts` unchanged; p500's references to
`core/PhysicsAPI.ts` lines are updated to the new files in Phase 8.

### D13. The collider derivation moves into physics and is fixed

`MeshUserData.ts` → `features/physics/import/ColliderBounds.ts`: a pure function returning the
shape's dimensions (and its orientation quaternion from `spineAxis`, M2) from the geometry's bounds
and the node's scale, instead of writing names into `userData` for another function to read back.
`deriveColliderDimensionsFromMesh` (the code-made path, `createGeometry`'s names) moves next to it
and stays as it is. `ThreeVector3` becomes private to `ThreeMath.ts`. No template asset has such a
collider, so no hash moves (p613 Phase 0).

### D14. The physics detail moves into `features/physics/CLAUDE.md`

The root CLAUDE.md's Physics section (the worker targets, the transform buffer, the deterministic
loads, the tiers) moves into a nested file, as p610 did for characters; the root keeps the
simulation rules every session needs (step-index time, seeded streams, the simulation lint) and a
line in the map. The Hub's `aek:covers="Physics"` follows the new `##` sections.

### D15. No example scene

A review plan adds no feature to show. The physics feature and example pages are checked against
the code (Phase 8).

## 3. Phases

Each phase leaves the tree green: `yarn test`, the lint and `tsc` (the Stop hook), and the phase's
own checks. `yarn verify:scenes` runs at the end of Phases 1, 4, 5 and 7 and in Phase 9
(snapshots and hashes unchanged unless a phase says otherwise; no file is edited while it runs). A
split phase fixes the Hub links it breaks (`api:PhysicsAPI.createJoint`, the API pages' paths in
`hub/pages/features/physics/guide.md`) and runs `yarn hub:build`. Each phase ends with its "As
built" list, its files' JSDoc at 100% (exports and members, the `@param x (type)` form rewritten)
and the updated `docs.json` (`yarn verify:baselines --docs --update`).

### Phase 0: baselines and measurements

1. `yarn verify:scenes --update` on this commit (= `main`), then `yarn verify:baselines` clean.
2. `perf-auditor` over `features/physics/` and `Raycast.ts`: confirm or add to §1.4's (perf) items.
3. Measure on `physicsTiers` (687 bodies) in both worker targets: the worker's write-back time
   per STEP message, the main thread's GC per frame with the gym's characters, and the
   `MESSAGE_BATCH` push size (D11's baseline).
4. Reproduce A1 (a TRIMESH collider without indices in `WORKER_THREAD` mode) and E1, so their
   tests start red.
5. Record the numbers here and confirm D1-D15.

### Phase 1: the bugs (D4)

1. A1 with the transport's error contract (in `PhysicsAPI.ts` for now; Phase 2 moves it).
2. A2, A3 / W1, A4, R1 (D4b), R2, R3, E1, M3, each with its test (D10).
3. `yarn verify:scenes`: only `scene01`'s and the gym's hashes move (D4b), re-recorded with the
   reason after the hand check.

### Phase 2: the transport and the stop (D5, D6)

1. `transport/PhysicsTransport.ts` and its two implementations; every `postMessage` and the
   worker's listener go through them.
2. `FeatureContext.onUnmount` (`kernel/init/Features.ts`, run by `Mount.ts`' teardown) and
   physics' stop (X1).
3. The facade test with a stub transport (D10). `verify:embed` (the banner's unmount) and the
   scene runner's physics scenes in all three targets.

### Phase 3: the types (D7, D9)

1. `PhysicsAPITypes.ts` into `types/` and `protocol/`; every importer updated (no barrel), the
   entry re-exporting from the new files.
2. T2 (`ENGINES` keyed by a literal union), T4, the protocol `@internal`, the public types and
   members documented.

### Phase 4: the facade (D7, D8)

1. `PhysicsAPI.ts` into its modules and `proxies/`; A5's duplication, A6-A9, W5.
2. D8's return types. The debug modules' imports updated (p618's files, imports only).
3. `PhysicsWorker.test.ts`, `ModuleLoad.test.ts`, `moduleSideEffects.test.ts`; `yarn verify:scenes`.

### Phase 5: the backend (D7, D11)

1. `EngineRapier.ts` into its modules and `proxies/`; R6-R8.
2. D11 (R4, R5, W3) with Phase 0's measurements repeated; the worker switches typed against
   `PhysicsDownProtocol` (W2, the `any`s gone).
3. `yarn verify:scenes` (hashes unchanged: the same Rapier calls in the same order).

### Phase 6: entities, tiers and the policy

1. `PhysicsEntity.ts`: the interpolation into `PhysicsInterpolation.ts` (E2), E3, E4's docs and
   `@internal`s, E5, E6's one helper.
2. The tiers and the policy: P1-P4.
3. `PhysicsUtils.ts`, `Engines.ts`, the buffers' members documented.

### Phase 7: the derivation, ray casting, the character items

1. D13 (M1, M2, M4) with its per-shape tests.
2. `Raycast.ts`: C1 (the raycaster made on first use, measured with `yarn sbp`), C2, C3.
3. The four character items (D8).
4. `yarn verify:scenes`.

### Phase 8: the Hub, CLAUDE.md, readme, and what's filed

1. The physics feature and example pages checked against the code (the stop, the transport's
   mention for networking, the tiers); the guide's API links.
2. D14's nested CLAUDE.md; the root's map line; `readme.md` if a listed API changed.
3. `p622_engine-6-major.md` (D3) checked complete; p500's and p428's references updated; p511's
   grounding names the transport's file.
4. `yarn hub:build` (no new warning in scope; the `notExported`s of §1.2 gone).

### Phase 9: versions and done

1. D2's bumps, a `CHANGELOG.md` entry (D4b's behaviour change and D6 called out),
   `yarn checkVersions --against main`.
2. `yarn test`, `yarn verify:scenes`, then `yarn verify:scenes --browser firefox` (Firefox's
   hashes equal Chromium's, p605 Phase 6), `yarn verify:baselines` (no unexplained growth),
   `yarn build` (the SBP budgets), `yarn hub:build`.
3. Mark the plan done (`docs/plans/CLAUDE.md`); time for a PR: this branch into `main`
   (p600's "Branches and PRs").

## 4. Risks

1. **The splits and import cycles.** The facade's modules share state; a cycle between them reads
   a binding before its module ran (a TDZ error at load). `ModuleLoad.test.ts` imports every
   module in Node, and the state lives in leaf modules (`PhysicsState.ts`, `PhysicsRegistry.ts`)
   that import none of the others.
2. **The worker bundle.** A type or helper moved into a module that imports three or the facade
   pulls them into the worker. `PhysicsWorker.test.ts` fails on it.
3. **D4b.** The gym's characters on frictionless platforms may play differently (sliding,
   carousels). The hand check decides whether the gym wants 0 there after all, in which case the
   scene changes, not the engine.
4. **A1's rejections.** Code that awaited a create that silently hung now gets an error: a scene
   with a broken collider fails its load visibly (`loadScene` resolves `false`) instead of
   hanging. The scene runner shows any such scene.
5. **The Hub's API links.** The module pages move with the split; a dead `hub:` / `api:` link
   fails `yarn hub:build`, so each split phase fixes its links.

## Done when

- Every file in scope reviewed against p600 §5, the findings fixed or filed (`docs/issues/` or a plan item).
- JSDoc coverage of the scope's public exports at 100% (p601's `docs.json`), members included; the ratchet raised.
- `yarn test`, `yarn verify:scenes` (snapshots and hashes unchanged unless stated), then `yarn verify:scenes --browser firefox` (p605 Phase 6: Firefox's hashes equal Chromium's), `yarn verify:baselines` (no unexplained growth), `yarn build`, `yarn hub:build`. The verify commands run for minutes to hours: when one starts, give the watch command, `tail -f .cache/verify/progress.log`.
- The Hub pages of the features in scope checked against the code; CLAUDE.md's nested files for them current.

## From p611 (2026-10-14)

Moved to `p622_engine-6-major.md` with D3's decision (the tiers as a feature of their own need the
major). Kept here for the record:

- **`physics()` has no stop:** `mountAekasha`'s `unmount()` (p611 Phase 3) stops the loop, the
  input, the assets worker and the renderer, but leaves a physics worker running. (D6.)
- **Leaving the tiers and the tier policy out** (p611 D10, measured in its Phase 5 §2). `physics()`
  installs both (`installPhysicsTiers`, `installPhysicsTierPolicy`, and the exit hook's
  `deleteScenePhysicsTierPolicies`) whether the app uses them or not. A scratch build of the app
  without those three calls: the initial load 389.0 → **384.8 KiB gzip (−4.2 KiB, −1.1%)**. A
  runtime option saves nothing, installing on first use registers systems mid-run, so a feature
  of its own, `physicsTiers()` (`requires: ['physics']`), in the engine's next major. Its exit hook
  would then run before physics' (reverse install order): check that a policy's members don't need
  their bodies while it's deleted.
