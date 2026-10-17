Status: in progress | Phases 0-6 implemented
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
- A10 **(bug, found in Phase 0)** A create of a body and its colliders isn't all or nothing: when a
  collider throws after its body exists, the body stays in the world (and in `WORKER_THREAD` mode
  its transform slot stays taken), and `createPhysicsEntity` deletes the entity, so nothing owns
  it. Both targets: `createRigidBodyWithCollidersSync` (`PhysicsAPI.ts:1996-2005`) and the worker's
  `CREATE_PHYSICS_ENTITY` (`PhysicsSwitchRigid.ts:84-95`, which already undoes the body on a
  refused slot).

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
- W7 **(bug, found in Phase 0: A1's worker half)** `handleMessage` awaits only the WORLD switch
  (`PhysicsWorker.ts:91`); the RIGID, COLL and JOINT switches are `async` and returned without
  `await` inside the `try` (`:94-100`), so their throws skip the `catch`: the worker sends no
  `ERROR` at all, and the browser reports an unhandled rejection in the worker. So A1's facade fix
  alone settles nothing for a body, collider or joint create.

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

- ~~the six `RayCastOpts` aliases (this plan tags them "removed in engine 6.0.0")~~: removed in
  Phase 7 instead (no entry exports them; confirmed 2026-10-17);
- p611's `physicsTiers()` feature (the "From p611" analysis below moves there with it). Until
  then `physics()` stays as it is, as p611 advised for a major without it;
- `createPhysicsEntity`'s options object (E4): 53 callers and the readme's example, so a candidate
  for the major, not a minor's deprecation churn;
- `WorldAPI`'s positional queries (A8): they mirror Rapier's, and only a backend change (Jolt)
  would be a reason to reshape them.

### D4. The bugs are fixed first (Phase 1), each with a test

A1, A2, A3 / W1, A4's throws made quiet no-ops (with the error message fixed), R1, R2, R3, E1, M3.
M1 and M2 go with D13 (Phase 7). Phase 0 added W7 (A1's worker half, fixed with A1) and A10 (the
create undone when a collider throws, both targets) to Phase 1 (confirmed 2026-10-16).

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

### Phase 0: baselines and measurements — done

1. `yarn verify:scenes --update` on this commit (= `main`), then `yarn verify:baselines` clean.
2. `perf-auditor` over `features/physics/` and `Raycast.ts`: confirm or add to §1.4's (perf) items.
3. Measure on `physicsTiers` (687 bodies) in both worker targets: the worker's write-back time
   per STEP message, the main thread's GC per frame with the gym's characters, and the
   `MESSAGE_BATCH` push size (D11's baseline).
4. Reproduce A1 (a TRIMESH collider without indices in `WORKER_THREAD` mode) and E1, so their
   tests start red.
5. Record the numbers here and confirm D1-D15.

As built (2026-10-16, at `b8d29ce` = `3d0d098` plus this plan and p622; macOS, headless Chromium,
WebGPU):

- **Baselines:** `yarn verify:scenes --update` recorded 104 runs (26 scenes × 4 configurations) in
  410 s, without errors outside the allowed ones. `yarn verify:baselines`: all unchanged (`docs.json`
  1794 / 2286 exports, 331 / 434 members).
- **Repro (step 4):** `features/physics/PhysicsWorkerRequests.test.ts` runs the real worker module
  and Rapier in Node behind a fake `Worker` (structured clones on a macrotask, replies can be held),
  for the facade tests of D10 too. Three `it.fails`, each failing on its own assertion: A1's
  `createCollider` and A1's `createPhysicsEntity` (both stay pending: W7, then A1), E1 (the deleted
  entity gets its `COLLIDER` back). Red as `it`, green as `it.fails`; `yarn test` 570 passed and 3
  expected fails.
- **D1-D15 confirmed** as written (2026-10-16). W7 and A10 added to D4's Phase 1 list, and D11's
  shape cache dropped (below), both confirmed.
- **The perf audit (step 2)** confirms A7, E3, R4, R5, W3, P2 and C1 at their lines, with these
  corrections and additions:
  - W3: the walk skips a slotless (`FIXED`) body before its proxy lookup, but iterates every body
    id to find out; the four allocating reads are per slotted body.
  - R4: Rapier's `Ray` and shapes are plain JS objects: `castShape` builds the raw shape from one
    and frees it on every call (checked in 0.19.3's bundle), so nothing leaks, and the saving is
    the JS objects only, as D11 says. Two more `new RAPIER.Ray` per call: `castRay`
    (`EngineRapier.ts:1366`) and `intersectionsWithRaySync` (`:1569`, plus a closure per call).
  - R5 is on the main thread too: `readPoseInto` (`syncBodyPose`'s read) allocates Rapier's
    `translation()` / `rotation()` objects per dynamic visual body per frame (Rapier has no
    allocation-free getter).
  - P2: the pass also allocates in `decide` (measured below), and `getEntityBody` reads two
    components per member.
  - New, minor: `physicsToTransformSystem`'s moved-statics loop (`PhysicsEntity.ts:530`) iterates
    `[entityId, untilStep]` entries (an array per entry, against the file's own comment at `:518`);
    `new THREE.Timer()` at `PhysicsAPI.ts:1071` is a module-load allocation like C1's.
- **Measurements (step 3)**, 12 s each after a 10 s settle, debug env (`?isDebug=true`, the
  runner's `AEK_debugPhysicsApiBoot` overrides); the gym with both players walking and turning.
  Main-thread allocations from CDP's sampling heap profiler (512 B interval, collected objects
  included), GC from trace events, the worker's write-back from a temporary timing patch in
  `writeBackTransforms` (reverted, nothing committed):

  | | `physicsTiers` SAB | `physicsTiers` MSG | `physicsTiers` main | gym SAB | gym MSG | gym main |
  | --- | ---: | ---: | ---: | ---: | ---: | ---: |
  | Bodies with a slot | 197 | 197 | — | 14 | 14 | — |
  | Write-back per STEP, avg / p95 (ms) | 0.188 / 0.255 | 0.191 / 0.265 | — | 0.060 / 0.155 | 0.054 / 0.125 | — |
  | `MESSAGE_BATCH` copy, avg (ms) | — | 0.030 | — | — | 0.062 | — |
  | `TRANSFORMS_PUSH` size (B) | — | 106,504 | — | — | 106,504 | — |
  | Main-thread allocations (KiB / frame) | 262.1 | 262.5 | 277.6 | 70.1 | 70.9 | 72.2 |
  | of which physics, character, Rapier | 10.3 | 11.0 | 16.3 | 12.4 | 12.6 | 6.2 |
  | Main-thread GC (ms / frame) | 0.055 | 0.076 | 0.052 | 0.030 | 0.026 | 0.029 |
  | Worker GC (ms / frame) | 0.011 | 0.011 | — | 0.014 | 0.014 | — |

  The largest physics allocators, KiB / frame: `physicsInterpolationSystem` 1.4-4.0 in every run
  (not on §1.4's list, E3 is its lookups: Phase 6 finds what it allocates), `decide` 2.2 and
  `measure` 1.2 (P2, `physicsTiers`), `readBodyPositions` 3.6 and `readPoseInto` 3.3 / 1.7 (P2 and
  R5, `MAIN_THREAD`), `setNextKinematicTranslation` / `Rotation` 1.5 each (the gym's platforms in
  `WORKER_THREAD`: the captured commands' clones and `toPlainRot`, A7), `castRayAndGetNormal` 1.1
  (`WORKER_THREAD`: the request and its promise). `castRayAndGetNormalSync` is 0.2 (R4's `Ray`),
  and no shape cast reaches the top 12.

  What it means for D11: physics is 4-6 % of the main thread's allocations in `physicsTiers` and
  9-18 % in the gym (three's rendering is the bulk, ~167 KiB / frame in `physicsTiers`), and GC stays under 0.08 ms per frame everywhere.
  The `Ray` reuse is cheap and stays. The shape cache saves too little to be worth its
  identity-vs-dimensions trap (§1.2): Phase 5 drops it unless its own measurement disagrees
  (confirmed 2026-10-16). The
  `MESSAGE_BATCH` copy of the whole buffer is the clearest win: with 14 bodies it costs more than
  the write-back itself (106 kB for 728 B of live slots).

### Phase 1: the bugs (D4) — done

1. A1 and W7 with the transport's error contract (in `PhysicsAPI.ts` for now; Phase 2 moves it).
   `PhysicsWorkerRequests.test.ts`' `it.fails` become `it`.
2. A2, A3 / W1, A4, A10, R1 (D4b), R2, R3, E1, M3, each with its test (D10).
3. `yarn verify:scenes`: only `scene01`'s and the gym's hashes move (D4b), re-recorded with the
   reason after the hand check.

As built (2026-10-17):

- **A1 + W7:** the worker awaits all four switches (`PhysicsWorker.ts`' `handleMessage`), so a
  throw in any of them replies `ERROR` with the request's id. The facade's requests
  (`messageWorkerAsync`, `messageWorkerAtStep`) are created with their `reject`, and an `ERROR`
  with a pending `requestId` rejects it with `new Error('Physics worker: <message>')` (a plain
  `Error`, no new export). One without a request (a one-way command's) is logged as before.
  `messageWorkerAsync` without a worker rejects with an `Error`, not a string. Rejecting what's
  pending when the worker goes is Phase 2's (`close()`).
- **A2:** `createRigidBodies` posts `toWireRigidBodyParams` per body; a new `toWireJointParams`
  makes a `FIXED` joint's `frame1` / `frame2` plain. No other request posts a rotation unconverted.
- **A3 / W1:** `=== undefined` / `!== undefined`. No other truthy id check in `features/physics/`
  or `features/character/`.
- **A4:** the eight deletes return `undefined` / `[]` without a world. The sync ones still throw
  in `WORKER_THREAD` mode (a misuse, not a stale id), and an unknown id was already quiet in the
  backend (a debug-env warning). `WorldProxyAPI`'s `remove*` log a rejected delete
  (`logFailedRemove`); `deleteColliders(Sync)`' error says "colliders".
- **A10:** `createRigidBodyWithCollidersSync` makes the colliders one by one and, when one throws,
  deletes the body (which takes its colliders) or the colliders made before it. The worker's
  `CREATE_PHYSICS_ENTITY` does the same (`createEntityColliders` in `PhysicsSwitchRigid.ts`) and
  frees the body's slot. Still partial, left for A5's dedupe in Phase 4: `createColliders` and
  `CREATE_COLLIDERS` alone (no entity, no body).
- **R1, R2, R3** as found. R2 has no test: its branch needs a body handle Rapier no longer has,
  which the API can't make.
- **E1:** after the create's `await`, `createPhysicsEntityNow` checks `world.isAlive(entityId)`.
  For a deleted entity it deletes what the create made (`deleteCreatedBodyAndColliders`) and
  resolves with the dead id; `createPhysicsEntity`'s `@remarks` say so. The ECS side (a component
  added to a deleted entity is stored) is filed: `docs/issues/ecs-components-on-deleted-entities.md`.
- **M3:** one integer check after all three branches (none given, `nrows` only, `ncols` only), and
  null with the import and node named. Seen on the way, for Phase 7 (D13): with only `nrows` given,
  `nCols = totalVertices / nRows` doesn't match a `(rows + 1) × (cols + 1)` grid.
- **Tests (D10):** `PhysicsWorkerRequests.test.ts` (`WORKER_THREAD`, in-process worker: A1 × 2, A2,
  A3, A10, E1), `PhysicsAPI.test.ts` (`MAIN_THREAD`: A10 × 2, A4),
  `backends/rapier/EngineRapier.test.ts` (W1 through the real switch, R1, R3),
  `import/MeshColliderGeometry.test.ts` (M3 × 2 and a square grid). Each bug's test fails on
  Phase 0's code (checked by stashing the fixes). `yarn test`: 78 files, 586 passed.
- **The scene runner:** 95 of 104 pass. The 9 that fail are D4b's: `scene01`, `scene01V2` and
  `thirdPersonGymScene` in the three debug configurations (probe hashes and snapshots; the gym's
  character path hash too). That's **11 colliders in 3 scenes**, not §1.2's 8 in 2: `scene01V2.ts`
  has two (`:126`, `:169`) and the gym a seventh (`:654`). In the gym the players pass through the
  same locomotion states as before (the runner's note) and end on the floor elsewhere; nothing
  falls through. No other scene moved, so no scene had a worker error hidden by A1 (§4 risk 4).
- **Step 3 (D4b):** the hand check (the gym's moving platforms and carousels, `scene01` /
  `scene01V2`, both worker targets) found nothing to change: the scenes keep their `friction: 0`.
  `yarn verify:scenes --update --only scene01,scene01V2,thirdPersonGymScene` recorded the 12 runs
  (2026-10-17, at `c89535c`): probe hashes `7788c6ec` (`scene01`), `803f291b` (`scene01V2`) and
  `84a78084` (the gym, the same in all three targets), the gym's character path hash `26f43551`
  (`MAIN_THREAD`). Reason for the new baselines: R1's fix, the colliders get the friction 0 their
  code asks for.

### Phase 2: the transport and the stop (D5, D6) — done

1. `transport/PhysicsTransport.ts` and its two implementations; every `postMessage` and the
   worker's listener go through them.
2. `FeatureContext.onUnmount` (`kernel/init/Features.ts`, run by `Mount.ts`' teardown) and
   physics' stop (X1).
3. The facade test with a stub transport (D10). `verify:embed` (the banner's unmount) and the
   scene runner's physics scenes in all three targets.

As built (2026-10-17, at `49e1835`):

- **The transport:** `transport/PhysicsTransport.ts` (the type and its contract, `@internal`),
  `transport/WorkerTransport.ts` (`createWorkerTransport`, the main thread's, around the `Worker`;
  `close()` terminates it) and `transport/WorkerScopeTransport.ts` (`createWorkerScopeTransport`,
  the worker's, around `self`, read when called; `close()` stops this side only). Separate files,
  importing nothing but the type, so the worker bundle is unchanged. The facade holds
  `workerTransport` instead of a `Worker`; the worker sends everything through its transport, the
  handshake included. No `postMessage` or `self.addEventListener` is left in physics outside them.
- **Requests stay in the facade, not in the transport:** the transport carries messages only.
  `PromiseResolver`'s map is shared with the assets API, so the facade keeps its own
  `pendingWorkerRequestIds` (`createWorkerRequest`, also for requests captured for a sub-step),
  which the stop rejects. The type's comment says so.
- **`initWorker`'s `onMessage` is optional** (`kernel/loop/Workers.ts`): left out, the handler is
  cleared after the handshake and the transport listens (`addEventListener`). The assets worker
  is unchanged.
- **The worker's handler** is `void handleMessage(…)` (it never rejects since W7). Phase 1's
  harness lost its `workerRejections` check: an unhandled rejection fails the Vitest run instead.
- **`FeatureContext.onUnmount(fn)`** (`kernel/init/Features.ts`): synchronous (`unmount()` returns
  `void`), run in reverse install order and once each by `runFeatureUnmountHooks` (a throw is
  logged, the rest run), through `Boot.ts`' `stopEngineFeatures()`, which `Mount.ts`' teardown
  calls right after `stopMainLoop()`, so also after a failed boot. Never under `InitEngine`.
- **`stopPhysics`** (`@internal`, `PhysicsAPI.ts`; `physics()` registers it before `initPhysics`):
  `MAIN_THREAD` deletes the world; `WORKER_THREAD` closes the transport (the terminate takes the
  world, no `DELETE_WORLD` first) and rejects every pending request. Both release the hold, drop
  the gates, remove the visibility listener (now added once, `??=`, its remover kept; it was
  re-added per world, harmless in a `Set`) and forget the world (`clearDeletedWorld`, shared with
  `deletePhysicsWorld`). It's for good: `createPhysicsWorld` returns `undefined` after it, so a
  scene load still running at unmount makes no world.
- **Tests:** `transport/PhysicsTransport.test.ts` (both implementations against stub endpoints:
  order, removers, `close()`), D6 in `PhysicsAPI.test.ts` (`MAIN_THREAD`, the visibility listener
  through a mocked `onVisibilityChange`) and `PhysicsWorkerRequests.test.ts` (`WORKER_THREAD`: a
  held request rejected, the worker terminated, later requests and world creates refused),
  `Features.test.ts` (the hooks' order and errors), `Mount.test.ts` (the teardown calls
  `stopEngineFeatures`, after the loop stops, also after a failed boot). The "stub transport" of
  D10 is Phase 0's fake `Worker`: the facade creates its transport from the worker inside
  `initPhysics`, and no injection seam was added for tests. `yarn test`: 597 passed.
- **Docs:** the Hub's ECS guide (`ctx.onUnmount`) and embed walkthrough (what `unmount()` stops),
  the root CLAUDE.md (`onUnmount` in the `FeatureContext` list, the mount line, a transport line
  in Physics; D14 moves it in Phase 8), `docs/issues/remount-after-unmount.md` step 2.
  `yarn hub:build` clean; `docs.json` recorded (the `transport` folder 3 / 3, `kernel/init` 24 / 24).
- **Checks:** `yarn verify:embed` passed (the banner's two unmounts and the Hub's example page; the
  banner has no physics, so the stop itself is the unit tests'). `yarn verify:scenes`: 103 of 104;
  `thirdPersonGymScene` `workerMsg` once had a snapshot over the tolerance (0.43 % of pixels, spread
  over the surfaces) with its probe and character path hashes unchanged, and passed on two reruns:
  the gym's worker targets aren't deterministic (p428, its `unstableHash`). No hash moved.
- **Left:** `moveMap.ts --check` reports its outputs stale since Phase 1's test files; Phase 4
  regenerates them (D7).

### Phase 3: the types (D7, D9) — done

1. `PhysicsAPITypes.ts` into `types/` and `protocol/`; every importer updated (no barrel), the
   entry re-exporting from the new files.
2. T2 (`ENGINES` keyed by a literal union), T4, the protocol `@internal`, the public types and
   members documented.

As built, step 1 (2026-10-17, on `a28e28c`):

- **The layout:** 12 modules instead of D7's 6, to keep each under ~800 lines (`WorldAPI` alone is
  ~750, the protocol ~1,070). `types/`: `PhysicsCommonTypes.ts` (`PhysVector`, `PhysRotation`,
  `PhysicsBridge`, `OmitSync`: what every area uses), `PhysicsConfigTypes.ts` (the four unions,
  `PhysicsState`), `PhysicsBackendTypes.ts` (`EngineAPIType` alone: the backend contract, apart
  from the public types, T1), `PhysicsBodyTypes.ts`, `PhysicsColliderTypes.ts` (shapes, params,
  the collider enums), `PhysicsJointTypes.ts`, `PhysicsQueryTypes.ts` (the query observer, rays,
  hits, `QueryFilterFlags`), `PhysicsEventTypes.ts` (the event records, `ContactForceEventSnapshot`,
  `EventQueue`, `PhysicsHooks`, `SolverFlags`) and `PhysicsWorldTypes.ts` (`WorldAPI`, 771 lines with
  its commented-out Rapier members, which p421 / p423 / p250 cite). Each `*ProxyAPIType` /
  `RigidBodyWorkerEngine` alias went to its area. `protocol/`: `PhysicsProtocolType.ts` (the enum,
  the one runtime value), `PhysicsUpProtocol.ts`, `PhysicsDownProtocol.ts` (with `PhysicsResponse`
  and the response aliases). The types modules import only types; the enums and the snapshot class
  are their only runtime code.
- **A pure move:** the declarations sliced by line range from the old file (a script checked that
  every line landed once), and the 37 importers rewritten by name to one import per module (the
  entry keeps its values and types apart). No name, signature or comment changed; T4's line is
  still there for step 2.
- **Bundle:** byte-neutral. `QueryFilterFlags`' module is now used only by the character controller
  and the backend, so it left the main chunk for `DynamicCharacter.js` (main −0.1 kB, that chunk
  +0.1 kB); the worker's enums moved from `PhysicsWorker.js` to its `EngineRapier.js` chunk (±0.1
  kB). Checked against `a28e28c` built in a scratch worktree.
- **Baselines recorded:** `api.json` (164 moves, plus Phase 2's seven additions, which it hadn't
  recorded: `stopPhysics`, the transport's three, `stopEngineFeatures`, `FeatureUnmountHook`,
  `runFeatureUnmountHooks`), `bundle.json` / `bundle.banner.json` (Phases 1-3), and `docs.json` with
  `--allow-docs-drop`: `features/physics` lost 126 undocumented exports and 8 members, and the new
  `types/` and `protocol/` folders start with exactly those (step 2 brings them to none).
- **Also:** `moveMap.ts`' outputs regenerated (the new files map under the `features/` rule; the
  layout report lists the kernel's type imports by their new modules); the root CLAUDE.md's Physics
  line; the Hub's `yarn sbp --why physics` example now ends at `PhysicsAPI.ts`. `tsc`, the lint,
  `yarn test` (597 passed, the worker bundle and module-load tests among them) and `yarn hub:build`
  clean.

As built, step 2 (2026-10-17):

- **T2:** `PhysicsEngine` is the union `'RAPIER'` (`PhysicsConfigTypes.ts`) and `ENGINES` a
  `Record<PhysicsEngine, …>` (`@internal`), so `AppConfig.physics.physicsEngine` takes only a
  known key, and the types no longer import `Engines.ts`. **T4:** the line is gone.
- **D9:** the 107 response aliases moved into their own `protocol/PhysicsResponses.ts` (with a
  4-line `@internal` block each they'd have taken `PhysicsDownProtocol.ts` past 800 lines);
  `PhysicsUpProtocol`, `PhysicsDownProtocol`, `PhysicsResponse` and `PhysicsProtocolType` (its
  ranges per switch written on it) are `@internal` too. Also `@internal`: `EngineAPIType`,
  `PhysicsBridge`, `OmitSync`, `RigidBodyWorkerEngine`, `ColliderProxyAPIType`, `WorldProxyAPIType`,
  `ContactForceEventSnapshot`, `ENGINES`. Left public because an exported signature names them:
  `RigidBodyAttachState` (`reattachRigidBody`), `PhysicsBodyActivity`, `PhysicsQueryObserver`
  (`EngineRapier.ts`' exports, Phase 5's).
- **Coverage:** `types/` 52 / 52 exports and 22 / 22 members, `protocol/` 111 / 111, `backends/`
  1 / 1 (`docs.json` recorded). Past the ratchet, every member of `RigidBodyAPI`, `ColliderAPI`,
  `JointAPI` and `WorldAPI` (type aliases, which it doesn't count), each params field and each
  enum member has a summary. Each of the four APIs says once (`@remarks`) how the async forms and
  the `*Sync` twins behave per worker target, and which twins answer on WORKER_THREAD from the
  proxy's copy (checked against the proxies: `getUserDataSync` everywhere, `bodyTypeSync`,
  `body1IdSync` / `body2IdSync`, the world's settings and lookups by id); the `@param x − text`
  forms are gone. `PhysicsWorldTypes.ts` is 808 lines, ~370 of them the commented-out Rapier
  members p421 / p423 / p250 cite.
- **Wrong docs fixed:** `JointAxesMask` names the axes a GENERIC joint **locks**, not the free ones
  (Rapier's raw binding calls the argument `lockedAxes`); `QueryFilterFlags`' `EXCLUDE_KINEMATIC` /
  `EXCLUDE_DYNAMIC` comments were swapped (Rapier's own); `TempContactForceEvent` said not to keep
  it, but both targets hand the callback a copy (`ContactForceEventSnapshot`); `PhysicsState` named
  `performance.now()` and a `helpers.ts`; `ColliderParams.density` said "Mass", and `translation` /
  `rotation` "only without a body" (they're relative to the parent body); the copy-pasted "Get or
  set the numSolverIterations" on the PGS and CCD getters.
- **Found, for later phases** (documented as they are, nothing changed):
  - `isBeingDeleted` (rigid body, collider, joint) is never set to true anywhere, but
    `MutualGravity.ts` reads it: Phase 4 sets it in the deletes, or p622 removes it.
  - `ActiveHooks`, `ActiveCollisionTypes`, `CoefficientCombineRule`, `ActiveEvents` and
    `SolverFlags` mirror Rapier's enums that nothing in the API takes or returns: no
    `ColliderParams` field sets a collider's active hooks or collision types, so `PhysicsHooks`
    can never run (and the facade's stepping passes none). Phase 8 files it: wire them into
    `ColliderParams`, or drop them in p622.
  - `WorldAPI.setMaxCcdSubstepsSync` is a one-way setter named like a sync getter (so `OmitSync`
    drops it from the worker proxy's type): p622.
  - `WorldAPI.step`'s `eventQueue` is ignored by the Rapier backend (documented).
  - The app's `physicsTest.ts:420` comment says the GENERIC demo's `axesMask` "frees" Y: Phase 8
    corrects it (an app comment; the demo can't show the difference, the box falls from rest).
- **Checks:** `tsc`, the lint, `yarn test` (597 passed), `yarn verify:baselines` (only the 107 alias
  moves; recorded), `yarn hub:build` (no new warning: no public signature names a type marked
  `@internal`), `moveMap.ts` regenerated (729 files).

### Phase 4: the facade (D7, D8) — done

1. `PhysicsAPI.ts` into its modules and `proxies/`; A5's duplication, A6-A9, W5.
2. D8's return types. The debug modules' imports updated (p618's files, imports only).
3. `PhysicsWorker.test.ts`, `ModuleLoad.test.ts`, `moduleSideEffects.test.ts`; `yarn verify:scenes`.

Step 1 runs in two sections, as Phase 3's did: the move (section 1), then A5-A9 and W5 (section 2).

As built, section 1 (2026-10-17, on `770613d`): the move.

- **The layout:** `PhysicsAPI.ts` is gone, with no barrel. In its place are 10 modules and `proxies/`.
  `PhysicsState.ts` holds `facade`, the state the modules share (`state`, `engAPI`,
  `engineInitiated`, `world`, `worldEnabled`, `transformBuffer`, `debugStateBuffer`;
  `@internal`), and the three getters. It's a leaf: it imports only types. `PhysicsRegistry.ts`
  holds the three maps, the WORKER_THREAD collider callbacks and the body-moved listener. Then
  `PhysicsStepStats.ts`, `PhysicsQueryStats.ts`, `PhysicsMessaging.ts` (the transport, requests,
  the sub-step capture, the pushes, `flushPhysicsEvents`, `toPlainRot` / `toWire*`) and
  `PhysicsStepping.ts` (`stepPhysics`, the hold, the clock and stamps, the limit, the gates, and
  `setPhysicsStepStatsEnabled`, which messages the worker, so it's here and StepStats stays below
  Messaging). Then `PhysicsBodies.ts` (with `PhysicsCapacityError`, `getPhysicsBodyCapacity`,
  `createRigidBodyWithColliders`), `PhysicsColliders.ts`, `PhysicsJoints.ts` (with the joint
  walks), `PhysicsWorld.ts` (`initPhysics`, the world's life, `stopPhysics`, the snapshots, the
  debug-state tracking, the debug tab's two wrappers), and `proxies/{World,RigidBody,Collider,Joint}ProxyAPI.ts`
  (exported `@internal`). D7's `PhysicsState.ts` had `initPhysics` too; it's in
  `PhysicsWorld.ts`, so the state module stays a leaf (§4 risk 1).
- **Imports:** a DAG, State ← Registry / StepStats / QueryStats ← Messaging ← Stepping ← the
  proxies and Bodies / Colliders / Joints ← World, with one cycle: `PhysicsWorld` ↔
  `proxies/WorldProxyAPI` (the world makes the proxy; the proxy's `takeSnapshot` /
  `restoreSnapshot` call the world's). Only calls inside functions cross it, so nothing is read
  at load.
- **A pure move:** a script sliced the old file by line ranges and checked that every non-blank
  line landed once. The state reads became `facade.*` and the cross-module writes became small
  `@internal` functions (`openWorkerTransport` / `closeWorkerTransport` / `hasWorkerTransport`,
  `begin` / `endSubStepCapture`, `clearPendingEventPushes`, `recordMainThreadStepStats` /
  `recordPushedStepStats`, `setStepStatsBuffer`, `resetPhysicsStepStats`, `resetSimClock`,
  `clearPhysicsStepGates`, `dropStepAccumulator`, `breakSimHistory`, `clearPhysicsRegistry`,
  `getBodyMovedListener`, `getPhysicsQueryObserver`), each the code it replaced. No exported
  name or signature changed. The 22 importers were rewritten by name, the entry too, and the
  comments naming `PhysicsAPI.ts` were updated (engine, `CLAUDE.md`, the Hub,
  `hub-authoring.md`). `PhysicsAPI.test.ts` is now `PhysicsFacade.test.ts`. `PhysicsWorker.test.ts`
  forbids the 14 facade modules.
- **Bundle:** `assets/index.js` +2,335 B (+92 B gzip): the `facade.state.…` property names that
  the minifier can't shorten as it did the module-local `physicsState`, and the new helpers. The
  physics group's +4.5 kB gzip in the report is the visualizer's per-module gzip (28 modules
  instead of 15); its rendered size grew 1.5 kB. The other chunks changed by ±3 B (hashed
  names). `yarn sbp --why physics` now ends at `PhysicsBodies.ts` (the SBP guide updated).
- **Baselines:** `api.json` (the moves and the new `@internal` helpers), `bundle.json` and
  `docs.json`, recorded with `--allow-docs-drop`. The new `proxies` folder starts at 38
  undocumented members (the throwing `*Sync` twins outside `RigidBodyWorkerEngine`, the
  constructors, `id` / `parentId`), which section 2's dedupe rewrites and documents. The
  `notExported` warnings for the four proxy classes are gone, and the Hub builds with no
  new warning (four cross-module `{@link}`s now take their module path).
- **Left for later:** five app and toolkit comments that say "once `PhysicsAPI.ts` lands"
  (`largeWorld.ts` × 3, `Terrain.ts`, `ScatterOnSurface.ts`, all older than the file) go to
  Phase 8 with D2's toolkit patch. `devTools/sbp`'s tests name `PhysicsAPI.ts` in made-up module
  graphs (fixture data, not the tree), and stay as they are.
- **Checks:** `tsc` (both projects), the lint, `yarn test` (597 passed: the worker-bundle,
  module-load and side-effects checks among them), `moveMap.ts` regenerated (742 files, the
  same 41 boundary violations, 0 feature cycles), `yarn hub:build`.

As built, section 2 (2026-10-17): A5-A9, W5.

- **A5, the facade:** each create and delete branches once (`isWorkerTarget()`,
  `PhysicsState.ts`, used throughout the facade). On MAIN_THREAD the async form runs its `*Sync`
  one, which holds the main-thread body. `assertWorldCreated` and `assertMainThread` (the "Cannot
  use X in worker mode" throw) are shared. The registry's `forget*` helpers, `checkDeletedId` and
  `checkDeletedIds` replace the per-delete bookkeeping. `registerBodyProxy` and
  `registerColliderProxy` replace the three proxy registrations. The "Should not get here"
  throws are gone, and so are `WorldProxyAPI`'s `create*Sync` main-thread branches (it now
  just throws). `PhysicsBodies.ts` 571 → 430 lines, `PhysicsColliders.ts` 257 → 168,
  `PhysicsJoints.ts` 119 → 85. Small changes on the way: a `*Sync` delete called in
  WORKER_THREAD mode throws before it forgets the id (it used to forget, then throw), and
  `createRigidBodies([])` / `createColliders([])` resolve `[]` in WORKER_THREAD mode too (they
  threw).
- **A5, the proxies:** `queryWorker(type, idField, id)` (`PhysicsMessaging.ts`) is a query for
  one field of one object, typed by its `PhysicsQueryType<Id>`: the up messages that carry only
  `type` and the id, so the reply type follows from the type and the ~100 `*Response` imports
  are gone. `commandWorker` is the one-way form: it writes the id into the caller's literal, so
  a command made every step allocates nothing more. `throwWorkerSync` is the twins' throw.
  `RigidBodyProxyAPI` implements `RigidBodyAPI` (not `RigidBodyWorkerEngine`), so its twins
  inherit the interface's docs: 1,053 → 738 lines. The collider proxy is 441 → 303, the joint
  176 → 140.
- **A10's leftover:** the backend's `createColliders` is all or nothing (both targets call it).
- **A6:** `initPhysics`' doc rewritten; `holdPhysicsStepping`, `resetPhysicsWorld` and
  `resetPhysicsRayStats` name physics' scene hooks; the three `PhysicsManager` comments now name
  `PhysicsEntity.ts`, including `MutualGravity.ts` (D2's toolkit patch).
  `PhysicsEntity.ts`' two `SceneLoader.ts` mentions are Phase 6's (E5).
- **A7:** `stepPhysics` split into `takeFrameDelta`, `takeDueSteps`, `runMainThreadSteps` and
  `sendWorkerSteps`, so no function is over 150 lines. The sub-step capture is made on its first
  command (`isCapturingSubStep`), and `substepCommands` is sparse and made on the first captured
  command. A frame whose systems issue no command allocates neither, and its STEP carries no
  `substepCommands` (the worker reads `?.[i]`).
- **A8:** every facade export not on `aekasha/physics` is `@internal` (40), per the coding
  standard. The 8 undocumented ones have summaries, and the `@param x (type)` forms are gone.
  `isPhysicsSteppingHeld` and `getPhysGameTime` (deprecated) are among the 40.
- **A9:** the `ccdSubsteps` TODO is filed (`docs/issues/physics-ccd-substeps-setting.md`). The
  `isEnabled` cache is done: `isEnabledSync` answers on WORKER_THREAD from the proxy's copy
  (creation, `setEnabled`, reattach). `isBeingDeleted` is now set by every delete and by a world
  delete (the registry's `forget*` / `clearPhysicsRegistry`), as `MutualGravity.ts` expects. The
  snapshot `@TODO`s stay (D12).
- **A bug found on the way:** a REMOVED tier reattach (`PhysicsTiers.ts`' `returnToWorld`, `Fixed`
  for STATIC) left the WORKER_THREAD proxy's cached type at its old value, so `bodyTypeSync()`
  was wrong after REMOVED → STATIC. `_attach` takes the reattach state.
- **W5:** `RIGID_TRANSLATION`, `RIGID_ROTATION`, `RIGID_LINVEL` and `RIGID_ANGVEL` are gone from
  the switch, both protocols and the responses. Their numbers are commented as retired (418, 419,
  430, 432), and no other number moved. The worker's misplaced `allocateBodySlot` doc is back in
  place.
- **Tests:** createColliders all or nothing (both targets), `isBeingDeleted` (both), the reattach's
  type and enabled state, and the lazy capture. `yarn test` 603 passed.
- **Bundle**, against the committed baseline (Phase 3's): `assets/index.js` −7,661 B
  (−271 B gzip), so the dedupe more than pays back section 1's +2.3 kB, and the physics group
  is 11.2 kB smaller rendered. The worker chunk is −455 B (W5); `EngineRapier.js` is +100 B
  (`createColliders`).
- **Docs and baselines:** the `proxies` folder's members are at 265 / 265 (section 1's 38
  are documented, most by inheriting `RigidBodyAPI`'s docs), and `features/physics`' exports
  are at 191 / 205. `api.json` records the four removed response aliases and the new
  `@internal` helpers. The Hub builds with no warning in the facade's modules (`QueryTypeOf`
  and `DistributiveOmit` exported `@internal` for it), and the physics guide's API list now
  names `PhysicsState` instead of the all-internal `PhysicsWorld`. `moveMap.ts` was regenerated
  (`entryExports.json` follows the `@internal`s).

As built, steps 2 and 3 (2026-10-17):

- **D8 (step 2)** went with section 2: every facade create is annotated with what callers use
  (`Promise<RigidBodyAPI>`, `RigidBodyAPI[]`, `ColliderAPI`, `JointAPI`; the proxy
  registrations return the interfaces), and `RigidBodyProxyAPI` implements `RigidBodyAPI`, so no
  public signature names a proxy class. The debug modules' imports were rewritten in section 1.
  D8's three character types stay Phase 7's.
- **Step 3:** `PhysicsWorker.test.ts` forbids the 14 facade modules (section 1);
  `ModuleLoad.test.ts` and `moduleSideEffects.test.ts` pass (`yarn test`, 603).
  `yarn verify:scenes`: 104 passed, nothing recorded, in 408 s. No hash or snapshot moved:
  `physicsTiers` `49157b8f` and the gym `84a78084` (the same in all three targets), the gym's
  character path hash `26f43551` (`MAIN_THREAD`).

### Phase 5: the backend (D7, D11) — done

1. `EngineRapier.ts` into its modules and `proxies/`; R6-R8.
2. D11 (R4, R5, W3) with Phase 0's measurements repeated; the worker switches typed against
   `PhysicsDownProtocol` (W2, the `any`s gone).
3. `yarn verify:scenes` (hashes unchanged: the same Rapier calls in the same order).

Three sections, as Phase 4's: the move (section 1); R6-R8, W2 and the backend's docs (section 2);
D11 with its measurements, and step 3 (section 3).

As built, section 1 (2026-10-17, on `bdd6e70`): the move.

- **The layout:** `backends/rapier/EngineRapier.ts` holds only the `export … from` lines of the
  backend contract (the 31 names `EngineAPIType` lists), so `Engines.ts`' `import()` and the two
  tests that import it are unchanged. The code is in `RapierState.ts` (`backend`, the state the
  modules share: `RAPIER`, `world`, `isDebugEnvironment`, `eventQueue`, the two observers; the id
  maps, the detached bodies, the lookups, `toPlainVec` / `toPlainRotation`; a leaf, importing
  only types), `RapierEvents.ts` (the callbacks, counters and records, the drains),
  `RapierShapes.ts` (`paramsToShape`), `RapierBodies.ts` (create, delete, detach, reattach, the
  activity count and `readBodyPositions`), `RapierColliders.ts` (with `getCombineRule`),
  `RapierJoints.ts`, `RapierWorld.ts` (`init`, the world's life, `step`, the snapshots,
  `debugRender`; with the static `Rapier` import, D12) and `proxies/Engine{World,RigidBody,Collider,Joint}ProxyAPI.ts`
  (exported `@internal`). The largest is `EngineWorldProxyAPI.ts`, 532 lines. D7's
  `RapierState.ts` had the snapshots; they're in `RapierWorld.ts`, so the state module stays a
  leaf (as Phase 4 did with `initPhysics`).
- **Imports:** a DAG with no cycle: State ← Events / Shapes / the three object proxies ← Bodies /
  Colliders / Joints ← the world proxy ← World. Each running id counter (`next*Id`) is
  module-local in its module.
- **A pure move:** a script sliced the old file by line ranges and checked that every non-blank
  line landed once. Dropped: the two "proxy API definitions START / END" markers and R7's
  "NEW STUFF" line. The shared names became `backend.*` (`physicsWorld` → `backend.world`). Two
  helpers in `RapierEvents.ts` hold the lines that touched the event state from elsewhere:
  `registerColliderEventFns` (createCollider's tail) and `clearEventRegistrations` (deleteWorld's).
  `step` and the world proxy's `step` keep their own copies. Comments naming `EngineRapier.ts`
  for moved code now name the module (`PhysicsMessaging.ts` × 2, the init error's text, two in
  the proxies); the root CLAUDE.md's Physics line names the folder.
- **Docs:** the names the move newly exported (the maps, the detached types, the lookups,
  `toPlain*`, the proxy classes and their constructors / `id` / `parentId`) are documented and
  `@internal`. The `rapier` folder keeps the old file's 18 undocumented exports (section 2's);
  `proxies` is at 265 / 265 members.
- **Bundle:** unchanged; `bundle.json` recorded only the two `PhysicsWorker.js` chunks swapping
  their `#2` key (the same noise as the `EngineRapier.js` pair in earlier phases). `api.json`
  recorded the moves: `EngineRapier.ts`' 31 functions became references, and the new modules'
  exports were added.
- **Checks:** `tsc` (both projects), the lint, `yarn test` (603 passed: the worker bundle,
  module-load and side-effects checks among them), `moveMap.ts` regenerated (753 files, the same
  41 boundary violations, 0 feature cycles), `yarn hub:build` (no warning).
- **For Phase 8:** besides p500's (D12), the open plans p102, p250 and p306 name
  `EngineRapier.ts` and its old lines.

As built, section 2 (2026-10-17, on `173cad9`): R6-R8, W2, the docs.

- **R6:** `RapierWorld.ts` keeps the `PhysicsState` init() is given (`undefined` before), with no
  defaults of its own. `createWorld`'s timestep falls back to it, then to Rapier's own 1/60 (the
  facade and the worker always pass one). `physicsWorldAPI` is `WorldAPI | undefined` instead of
  an `undefined as unknown as` cast.
- **R7:** the `@CHORE`s and the three error-handling `@TODO`s are gone (A1 made those throws
  reach the caller); the snapshot `@TODO` stays (D12). The 8 `no-explicit-any` reads of Rapier's
  shape fields go through one typed view, `RapierShapeFields` (Rapier's JS shape classes share
  no type for them); `heightsSync` narrows to Rapier's `Heightfield` instead. The enum casts:
  `RapierEnums.ts` converts body and shape types (`as number as`), and `EngineRapier.test.ts`
  pins every mirrored enum pair (body type, shape type, the combine rule, active hooks / events
  / collision types, feature type, query filter flags, solver flags, joint axes) to the
  installed Rapier's names and numbers. All ten match Rapier 0.19.3. Stale comments fixed: the
  running ids' (`SceneLoader.ts` → physics' scene hooks), the callbacks map's ("the legacy
  file's multi-callback support": each collider gets one callback), `PhysicsWorker.ts`' name.
- **R8:** `PhysicsUtils.ts` lost `getColliderShapeName`, `getPhysicsEngineKey`, its own
  `setPhysicsPauseTime` (no callers) and `getEngineAPI`, whose one use was a
  `JSON.stringify` of the backend module in `PhysicsWorld.ts`' error, now "the physics engine is
  not initialized" (the only way `createWorld` returns nothing there). Its four exports are
  documented and `@internal` (Phase 6 step 3's part of it done).
- **W2:** `PhysicsWorkerReply` (`protocol/PhysicsDownProtocol.ts`, `@internal`) types the worker's
  `sendMessage` and every switch's. The rigid, collider and joint switches switch on `data.type`
  and reply with it, as the world switch did, so each reply is checked against its type's down
  message (all already matched: tsc found nothing). The `any`s and the file-wide
  `eslint-disable`s are gone; the not-found errors read the id with `'jointId' in data`. A string
  thrown in the worker reaches the caller as it is (no `toUpperCase`).
- **Docs:** the backend's exports are at 58 / 58, each `@internal` (none is on an entry); the
  contract's `init` doc no longer says it keeps the loop state (it never did).
- **Bundle and baselines:** `EngineRapier.js#2` −0.4 kB gzip (the defaults object and
  `PhysicsUtils.ts`' dead code), `assets/index.js` −0.1 kB rendered; the banner unchanged.
  `api.json` recorded R8's four removals and the four new `@internal` names (`RapierEnums.ts`' three,
  `PhysicsWorkerReply`); `docs.json`: `features/physics` 197 / 203 exports, `backends/rapier`
  58 / 58, `protocol` 108 / 108.
- **Checks:** `tsc` (both projects), the lint, `yarn test` (604 passed, the enum test new),
  `moveMap.ts` regenerated (754 files, the same 41 boundary violations, 0 feature cycles),
  `yarn hub:build` (no warning).

As built, section 3 (2026-10-17, on `4521fb0`): D11 and the measurements.

- **R4:** the world proxy's three ray queries share one Rapier `Ray` (`toRapierRay`, made on the
  first query), its origin and dir set per call. Rapier 0.19.3 reads them into raw vectors
  (`intoRaw`) before a query runs (checked in its bundle), so a query started from an
  `intersectionsWithRay` callback can reuse it; a test does exactly that. The shape cache stays
  dropped (Phase 0): no shape cast showed among the physics allocators in either run.
- **W3:** `PhysicsTransformBuffer` keeps each slot's body id (`getUsedSlotCount`, `getSlotId`),
  so the worker's write-back walks the slots instead of every body (FIXED ones have none), and
  `writeSlotFrom` writes a body straight into its slot through `readPoseInto` /
  `readVelocitiesInto`. A `MESSAGE_BATCH` push carries only the used slots (up to the highest
  one allocated, freed ones included) and the header (`copyUsedBank`); the main thread's wrapper
  keeps its own buffer and copies each push into it (`receiveUsedBank`), which replaces
  `rebind` and its new views per push. `buffer` is `readonly` now.
- **R5:** not changeable. Rapier's getters allocate per read (a raw WASM vector and a JS
  `Vector`), and it has no allocation-free one; the write-back makes the same four reads per
  body as before, through `readPoseInto` / `readVelocitiesInto` instead of `pos` / `rot` /
  `linvel()` / `angvel()`.
- **Measurements** (Phase 0's, repeated with a rebuilt harness: Playwright on the dev server,
  `?isDebug=true` with the scene runner's `AEK_debugPhysicsApiBoot` overrides, 12 s after a 10 s
  settle, the gym with both players walking and turning; CDP heap sampling at 512 B, GC from trace
  events, the worker's times from a temporary patch in `writeBackTransforms`, reverted; the
  harness is kept in the gitignored `.cache/p614/`). Before = section 2's code, after = D11, same
  session:

  | | `physicsTiers` SAB | `physicsTiers` MSG | `physicsTiers` main | gym SAB | gym MSG | gym main |
  | --- | ---: | ---: | ---: | ---: | ---: | ---: |
  | Write-back avg, ms | 0.097 → 0.125 | 0.096 → 0.092 | — | 0.014 → 0.013 | 0.015 → 0.011 | — |
  | `MESSAGE_BATCH` copy avg, ms | — | 0.015 → 0.008 | — | — | 0.015 → 0.002 | — |
  | `TRANSFORMS_PUSH` size, B | — | 106,504 → 35,732 | — | — | 106,504 → 736 | — |
  | Physics allocations, KiB / frame | 10.1 → 10.3 | 10.8 → 10.8 | 16.3 → 16.2 | 11.0 → 11.0 | 10.7 → 11.6 | 7.5 → 7.6 |
  | Main-thread GC, ms / frame | 0.040 → 0.047 | 0.057 → 0.048 | 0.040 → 0.040 | 0.019 → 0.021 | 0.023 → 0.017 | 0.017 → 0.017 |

  The push is the gain: 99 % smaller in the gym, and its copy a seventh of the time.
  `physicsTiers` keeps 687 used slots (its tiers free and reuse them), so its push is a third.
  The write-back and the allocations didn't move beyond the run-to-run noise: SAB and MSG run
  the same write-back code and differ by 0.03 ms in one run, and Phase 0 measured twice these
  write-back times on the same scenes. The heap sampler doesn't see an `ArrayBuffer`'s backing
  store, so the 105 kB per frame the push no longer allocates shows at most in the GC column.
- **Tests:** `PhysicsTransformBuffer.test.ts` (new: the slot walk, `writeSlotFrom`, a push and
  a larger one copied in with their step stamps) and the ray reuse in `EngineRapier.test.ts`.
  `yarn test` 608 passed.
- **Bundle:** the worker chunk +0.2 kB gzip (the buffer's new methods); `assets/index.js` +1.9
  kB rendered (+0.5 kB in the visualizer's per-module gzip): `PhysicsTransformBuffer` is one
  class for both sides, so the main chunk carries the worker's methods too. The two
  `PhysicsWorker.js` chunks swapped their `#2` key again. `api.json` unchanged; `docs.json`:
  the buffer's 4 new members documented. Recorded.
- **Step 3:** `yarn verify:scenes`: 104 passed, nothing recorded, in 408 s. No hash or snapshot
  moved: `physicsTiers` `49157b8f` and the gym `84a78084` (the same in all three targets), the
  gym's character path hash `26f43551` (`MAIN_THREAD`). Also `tsc` (both projects), the lint,
  `yarn hub:build` (no warning), `moveMap.ts` regenerated.

### Phase 6: entities, tiers and the policy — done

1. `PhysicsEntity.ts`: the interpolation into `PhysicsInterpolation.ts` (E2), E3, E4's docs and
   `@internal`s, E5, E6's one helper.
2. The tiers and the policy: P1-P4.
3. `PhysicsUtils.ts`, `Engines.ts`, the buffers' members documented.

As built, section 1 (2026-10-17, on `bd639f7`): `PhysicsEntity.ts`.

- **E2:** the render interpolation is `PhysicsInterpolation.ts` (492 lines; `PhysicsEntity.ts`
  993 → 614), sliced by line range like the earlier moves. The maths are unchanged. Its exports
  are `@internal`: `physicsInterpolationSystem`, `onPhysicsTransformReset` (newly exported;
  `installPhysicsEntities` still registers both, at the same place, so no registration order
  moved), `resetPhysicsInterpolationHistory` (the delete hook calls it now, instead of reaching
  into the state map), `setPhysicsInterpolationPinnedToNewest`, `getPhysicsInterpolationReadout`
  and `PhysicsInterpolationReadout`. The test bridge, the Physics API tab and `PhysicsTiers.ts`
  import from the new module. Gone: an orphan JSDoc above `capturePose`, and the `@param x (type)`
  form.
- **E3:** the system reads the `DISABLED` and `OBJECT3D` storages once per frame. That doesn't
  change its allocation, and Phase 0's question ("Phase 6 finds what it allocates") has a
  different answer: **it's V8's tiering, not the code.** Measured with Phase 5's harness
  (`.cache/p614/measure6.ts`, filtered runs) plus three probes kept next to it (`optStatus.ts`,
  `storeProbe.ts`, `traceDeopt.ts`; `variants.sh`):
  - `physicsTiers` blends 30 entities per frame and the gym 14; the system allocates 3.7-3.9 and
    1.4-1.5 KiB / frame, before and after E3.
  - Not the pose writes: three temporary variants (direct position field writes, no quaternion
    write, neither) all measured 3.7-3.8 KiB. Not a callee either: with inlining off
    (`--max-inlined-bytecode-size=0`) the function's own allocation is the same.
  - `--trace-opt --trace-deopt`: the system is compiled by **Maglev** and never reaches
    TurboFan within the 12 s window (one early deopt, "insufficient type feedback for binary
    operation", then Maglev again). With `--js-flags=--no-maglev` it drops to 1.0 KiB / frame
    (`physicsTiers`) and 0.47 (the gym): about two thirds is Maglev boxing doubles.
  - So nothing here to change: GC stays under 0.05 ms / frame (Phase 5), and steering V8's
    tiers would mean rewriting the maths, which D7 keeps as they are. A side finding: in bare
    three (Node), a single non-number store into any `Vector3`'s `x` generalizes the field for
    every `Vector3`, after which each double store allocates. In the app, a `Vector3.set` loop
    allocated 12 B per call (a `Quaternion.set` loop none), but that probe can't tell a tagged
    field from the boxed argument of a call Maglev didn't inline. `--trace-generalization`
    (it doesn't name the map) shows three double → tagged generalizations, all in three's
    code: `y` in a `set`, `z` in the render list's `resetRenderItem` and `get`. The engine
    sites it lists are object literals (`Casts.ts`' records, the toaster's offsets). Open,
    not physics': whether a three maths class is generalized in the app.
- **E4:** `createPhysicsEntity` has `@param`s for its five parameters (the `target` doc moved out
  of the signature), the dimensions it derives from a `createGeometry` mesh, and an `@example`
  (type-checked). `getPhysicsEntityByAppId` now does what its name says: undefined for an entity
  that isn't a physics entity (no `TAG_IS_PHYSICS_OBJECT`; the tag is added at the call, so an
  entity counts before its body exists). It has a summary and an `@example`. **A behaviour
  change** (it returned any entity's id), for D2's changelog; no caller in the template.
  `disposePhysicsEntity` isn't exported any more (its only caller is the delete hook) and has a
  summary. `deriveColliderDimensionsFromMesh` is `@internal` until Phase 7 moves it (D13). The
  other non-entry exports are `@internal`: the installs and debug registrations,
  `settlePendingPhysicsEntities`, `deleteAllPhysicsEntities`, `PhysicsBodyOwner`,
  `getPhysicsBodyOwner`, `queueStaticBodySync`, `physicsToTransformSystem` (its doc said only
  "Update transform from physics").
- **E5:** `import/MeshColliderGeometry.ts`' path; the two `SceneLoader.ts` mentions now name
  physics' scene hooks (`entered`, `exit`); the `FIXED_PHYSICS` warning names
  `PhysicsState.interpolationMode` instead of the deleted p059 plan.
- **E6:** `getPhysicsEntityBody` (`PhysicsEntity.ts`, `@internal`) replaces the three copies
  (`PhysicsEntity.ts`, `PhysicsTiers.ts`' `getTierBody`, `PhysicsTierPolicy.ts`).
- **Also:** the four remaining `PhysicsManager` comments, all in debug files
  (`_dbg__PhysicsAPI.ts`, `_dbg__PhysicsDebugDraw.ts` × 2, `_dbg__OnScreenTools.ts`), now name
  `PhysicsInterpolation.ts` / `PhysicsEntity.ts` (comments only, p618's files). No
  `PhysicsManager` is left in `src/`.
- **Tests:** `PhysicsFacade.test.ts`, E4 (`getPhysicsEntityByAppId` with a plain entity, a physics
  one and a missing id; fails on the old code) and E6 (the helper's body). `yarn test` 609 passed.
- **Baselines:** `api.json` (the five moves, `disposePhysicsEntity` removed, `getPhysicsEntityBody`
  and `onPhysicsTransformReset` added), `docs.json` (`features/physics` exports 197 / 203 →
  200 / 204; the four left are steps 2 and 3's), `bundle.json` (only the two `EngineRapier.js`
  chunks swapping their `#2` key again). No debug code in either build.
- **Checks:** `tsc` (both projects), the lint, `yarn test`, `moveMap.ts` regenerated (755 files,
  the same 41 boundary violations, 0 feature cycles), `yarn hub:build` (no warning in the files
  touched). `yarn verify:scenes` isn't due until Phase 7 (§3).
- **Filed:** `docs/issues/three-vector3-store-allocates-in-app.md` (the `Vector3` finding above).

As built, section 2 (2026-10-17): the tiers and the policy.

- **P1:** `readCameraFocus` reads the default world's main camera through `getMainCamera()`
  (p612 D7's cached id); another world keeps the `TAG_IS_MAIN_CAMERA` query.
- **P2:** the `STEPS` pass allocates nothing but a WORKER_THREAD request (its promise and
  closure). Measured on `physicsTiers` (687 members, a pass every 10 steps), KiB / frame, before
  → after:

  | | MAIN_THREAD | WORKER_THREAD SAB |
  | --- | ---: | ---: |
  | `decide` (own) | 2.15 → 0 | 2.11 → 0 |
  | `decide`'s `Map.set` | 2.69 → 0 | 2.68 → 0 |
  | `measure` (own), its `filter` and `sort` | 1.13 + 0.85 + 0.33 → 0 | 1.12 + 0.85 + 0.34 → 0 |
  | Physics, all | 16.4 → 13.2 | 10.0 → 6.9 |

  Main-thread GC stayed at ~0.05 ms / frame (the noise). What allocated, and the fixes:
  - `decide`: `for (const [id, ring] of desiredRings)` made an array per entry, and the per-pass
    maps rebuilt their tables after each `clear()`. The pass now keeps three parallel arrays
    (entity id, ring, joint group; written by index, never shrunk) in measurement order, which
    was the maps' insertion order, so the requests go out in the same order. `refusedGroups`
    (joint groups only) is cleared only when it holds something: a `clear()` allocates a
    table even for an empty map.
  - `measure`: `[...keys()].sort()`, the `filter` and the growing `bodyIds`. A measurement is
    now pooled with its arrays (`takeMeasurement` / `releaseMeasurement`, on decision or drop).
    Its `use` counter replaces `dropped`, so a late reply to an earlier use is ignored, and so
    is its error: the error path no longer releases a gate the next use holds. The ids sort in
    an `Int32Array` (ECS ids are int32: `(gen << 20) | index`, negative from generation 2048, in
    the same numeric order as before), through a `subarray` view, since no int32 is safe as
    padding. The MAIN_THREAD positions buffer is kept with the measurement. Pooling `bodyIds`
    is safe because a request captured for a sub-step is `structuredClone`d at capture, and one
    outside a sub-step is posted (cloned) at once.
  - Then `measure`'s own 1.3 KiB stayed: a pass runs 6 times a second, too rarely for V8 to
    optimize it, and an unoptimized `for … of` over the members allocates a result object per
    member (~20 B × 687). The member walk is the builtin `Map.prototype.forEach` with a
    module-level callback, behind an `instanceof Map` check (every storage but a `TYPED_ARRAY`
    `TRANSFORM` is a `Map`; anything else keeps the walk).
  - FRAMES: its two arrays are refilled by index instead of `length = 0` (which frees V8's
    storage).
  - `yarn verify:scenes --only physicsTiers`, after each change: `49157b8f` in all three
    targets, prodTest passing. The policy decides as before.
- **P3:** `getPhysicsTierPolicy`, `getPhysicsTierPolicyStatus`, `setPhysicsTierPolicyFrozen`,
  `isPhysicsTierPolicyFrozen`, `getPhysicsTierPolicyFreezeSources` and
  `DETERMINISM_PROBE_FREEZE_SOURCE` are `@internal` (the debug tab and the probe use them).
  `DEFAULT_TIER_POLICY_CADENCE` / `_INTERVAL` aren't exported any more (no importer;
  `PhysicsTierPolicy`'s fields document the defaults). The type re-exports in
  `PhysicsTierPolicy.ts` and `PhysicsTiers.ts` are gone (no importer). `PhysicsTierPolicyCadence`
  is on `aekasha/physics` now, since the entry's `PhysicsTierPolicy` names it (the standard's "no
  internal types in public signatures"). `PhysicsTierBucket` is documented and `@internal`, and
  `PhysicsTierRing.tier` has a summary. `@example`s, type-checked: `setPhysicsTierPolicy` (now
  fenced, with its import and a `sceneId`), `setPhysicsTierPolicyMember`, `requestPhysicsTier`,
  `getPhysicsTier`.
- **P4:** `isBodyJointed` (`PhysicsJoints.ts`, `@internal`) stops at the first joint on the body
  and needs no closure; it replaces the tiers' `bodyHasJoints`, which walked every joint.
- **Baselines:** `api.json` (the eight changes above), `docs.json` (`features/physics` exports
  202 / 203; the last, `PHYSICS_STEP_STATS_FIELD_COUNT`, is step 3's), `bundle.json` (the
  physics group +0.4 kB gzip, within the tolerance: the pool's code). No debug code in either
  build.
- **Checks:** `tsc`, the lint, `yarn test` (609 passed), `moveMap.ts` regenerated (756 files, the
  same 41 boundary violations, 0 feature cycles), `yarn hub:build` (no warning in the files
  touched).

As built, section 3 (2026-10-17): the rest of the folder's docs.

- `PhysicsUtils.ts` and `Engines.ts` were done in Phase 5 section 2 (R8, T2); `ENGINES`' `init`
  and `forceTypeEngine` fields got their summaries.
- The three buffer modules (`PhysicsTransformBuffer.ts`, `PhysicsDebugStateBuffer.ts`,
  `PhysicsStepStatsBuffer.ts`) export nothing on an entry: every export is `@internal` now, and
  every member documented (the constructors with their `@param`s, the transform buffer's four
  allocating getters pointing at `readPoseInto` / `readVelocitiesInto`, each debug flag).
  `PhysicsCapacityError`'s constructor (on the entry) got the summary its lone `@param` lacked.
- **Docs:** `features/physics` exports 203 / 203 and members 34 / 34 (`docs.json` recorded). Every
  physics folder of the ratchet is at 100 % but `worker/` (its four switches, 0 / 4), which no
  phase lists: Phase 8 documents them or files it.
- **Checks:** `tsc` (both projects), the lint, `yarn test` (609 passed), `yarn verify:baselines`
  (`api.json` unchanged; the physics group's visualizer gzip +0.5 kB is the comments, so
  `bundle.json` stays at section 2's), `yarn hub:build` (no warning in the files touched).

### Phase 7: the derivation, ray casting, the character items

1. D13 (M1, M2, M4) with its per-shape tests.
2. `Raycast.ts`: C1 (the raycaster made on first use, measured with `yarn sbp`), C2, C3.
3. The four character items (D8).
4. `yarn verify:scenes`.

As built, section 1 (2026-10-17, on `92d7dd5`): D13.

- **`import/ColliderBounds.ts`** replaces `kernel/mesh/MeshUserData.ts` (deleted).
  `getColliderBounds(type, geometry, scale, spineAxis)` returns the dimensions under
  `ColliderParams`' names: a box's `hx` / `hy` / `hz`, a sphere's radius (the bounding sphere's ×
  the largest scale, as before), and a capsule's, cone's or cylinder's `radius`, `halfHeight` and,
  for an X or Z spine, `orientation`. The maths are the old file's per shape: **M1**, so a capsule's
  `halfHeight` is its straight part's, a cone's and a cylinder's half the length, and both get a
  radius. Nothing is written into `userData`, and nothing to the registered geometry: it reads the
  geometry's cached bounds, or three's `computeBoundingBox` / `computeBoundingSphere` on a geometry
  sharing only its positions. `toSpineAxis` reads the custom prop (`x` / `y` / `z`, either case); the
  derivation warns about any other value, naming the import and node, and the shape stays on Y.
  Every export is `@internal`.
- **M2, two halves:** the derivation sets `orientation` (+Y onto +X: −90° about Z; onto +Z: +90°
  about X; a cone's tip goes with it). The backend then applied it and **replaced it with
  `rotation`** (`setRotation` twice), so a rotated compound member lost its spine. `RapierColliders.ts`
  now sets `rotation × orientation` (`getColliderRotation`), and `toWireColliderParams` makes
  `orientation` plain too. `ColliderParams.orientation` lost "Do not set manually", and its doc names
  the custom prop it really comes from (`spineAxis`; it said "orientation").
- **`deriveColliderDimensionsFromMesh`** (the code-made path, unchanged) is in its own
  `features/physics/ColliderDimensions.ts`, not in `import/` as D13 had it: `PhysicsEntity.ts` imports
  it statically, so it shares no module with the bounds code, which stays in the `ImportPhysics.js`
  chunk. `MeshColliderGeometry.ts` no longer imports `PhysicsEntity.ts`.
- **M4:** the scratch mesh is made only for HEIGHTFIELD (left to the garbage collector: never
  rendered, no GPU resources). `ThreeVector3` is private to `ThreeMath.ts`.
- **Phase 1's HEIGHTFIELD note:** with only `nrows` or only `ncols` given, the other count is read
  from the `(rows + 1) × (cols + 1)` grid (it divided the vertex count by the given count), and a
  grid under 1 × 1 cells is skipped like the other bad grids.
- **Tests:** `MeshColliderGeometry.test.ts` per shape (BOX, BALL, CAPSULE, CONE, CYLINDER, X and Z
  spines in either case, an unknown spine, given fields and the geometry left alone, a mesh shape
  left to its own derivation) and the oblong HEIGHTFIELD; `EngineRapier.test.ts` the rotation
  composition. Seven fail on `92d7dd5` (checked in a scratch worktree); BOX, BALL and the mesh
  shape passed before and are regression tests. `yarn test` 619 passed.
- **Bundle:** `ImportPhysics.js` −1,127 B rendered, +117 B gzip (the old duplicated cases compressed
  better), each `EngineRapier.js` chunk +74 B (the composition), `assets/index.js` +33 B (+8 B
  gzip); the banner unchanged. Recorded with `api.json` (the move, `setMeshCreatePropsToUserData`
  and `ThreeVector3` removed, `ColliderBounds.ts`' four added) and `docs.json` (`import` 7 / 7).
- **Checks:** `tsc` (both projects), the lint, `moveMap.ts` regenerated (757 files, the same 41
  boundary violations, 0 feature cycles), `yarn hub:build` (no warning). No template asset has a
  primitive imported collider, so no hash should move; `yarn verify:scenes` is step 4's.
- **Seen, not changed:** every primitive is centred on its node's origin, so a mesh whose bounds
  aren't centred there (a cone with its origin at its base) gets an offset collider. As before.

As built, section 2 (2026-10-17): `Raycast.ts`.

- **C1, measured with `yarn sbp --profile all` before and after:** the premise was half right.
  Rollup already dropped the module-level `new THREE.Raycaster()` where no cast is reachable (the
  banner had no `Raycaster` code), and the app keeps it because the input picking
  (`InputPicking.ts`, from `MouseInput.ts` / `TouchInput.ts`) casts. What the banner did carry was
  the stats: `new IntervalCounterStats(RAY_STATS_WINDOWS)` at load, reachable from the kernel's
  frame-end system. Both are now made on first use (`getRaycaster`, `getStats`; only the debug
  tools enable or read the stats), and the frame-end system returns before `performance.now()`
  with neither stats nor helpers. **Banner:** `banner.embed.js` −1,379 B rendered, −520 B gzip
  (67 → 65 modules: `IntervalCounterStats.ts` and `RayDebugTypes.ts` left it; initial 287.6 →
  287.1 kB gzip in the SBP report). **App:** unchanged (375.6 kB gzip; physics keeps the stats
  class, the picking the raycaster).
- **C2, changed from D3 (confirmed 2026-10-17):** the cast functions are on no entry (p606's
  `entryExports.json`: internal; the input picking and the ray tester are the only callers) and
  nothing used the six aliases, so they're **removed** in this minor instead of tagged for 6.0.0,
  with `resolveDebugOpts` and its shared object. p622's item is gone (D3 struck through). Filed:
  `docs/issues/three-ray-casting-not-public.md` (whether apps should get these functions on
  `aekasha`).
- **C3 and the API's shape:** every `Raycast.ts` export is `@internal` (the coding standard: not on
  an entry), its `@param x (type)` forms rewritten, and its unused type re-export of
  `RayDebugTypes.ts` dropped. `RayHelperKind`, `RAY_TESTER_ID_PREFIX` and `RAY_STATS_WINDOWS` are
  `@internal`. **`RayDebugOpts` is on `aekasha` now:** `WorldAPI`'s queries (on `aekasha/physics`)
  and the character casts name it (the standard's "no internal types in public signatures", as
  Phase 6 did with `PhysicsTierPolicyCadence`). Its doc says it's the physics queries' `debug`
  parameter too.
- **Tests:** `kernel/render/Raycast.test.ts` (new): the stats read and reset before anything made
  them, a cast on first use with `near` / `far` put back, `castRayFromPoints` stopping at the end
  point and filling a given `target`. `yarn test` 622 passed.
- **Baselines:** `api.json` (the re-export's two names removed, `aekasha` exports `RayDebugOpts`),
  `bundle.banner.json`; `bundle.json` and `docs.json` unchanged. No debug code in either build.
- **Checks:** `tsc` (both projects), the lint, `moveMap.ts` regenerated, `yarn hub:build` (417
  pages, no warning).
- **For Phase 9:** `yarn sbp`'s app profile already fails one budget, the physics group at 41.6 kB
  gzip against 36.0 kB (`sbp.config.ts`). It was over before this phase (40.9 kB: Phase 4's split
  counts each module's gzip, Phase 4 section 1), and section 1's new module adds 0.7 kB the same
  way. `yarn build` runs the budgets, so Phase 9 raises the budget with that reason, or shrinks
  the group.

### Phase 8: the Hub, CLAUDE.md, readme, and what's filed

1. The physics feature and example pages checked against the code (the stop, the transport's
   mention for networking, the tiers); the guide's API links.
2. D14's nested CLAUDE.md; the root's map line; `readme.md` if a listed API changed.
3. `p622_engine-6-major.md` (D3) checked complete; p500's and p428's references updated; p511's
   grounding names the transport's file.
4. `yarn hub:build` (no new warning in scope; the `notExported`s of §1.2 gone).
5. W6: the four worker switches (`worker/PhysicsSwitch*.ts`) documented and `@internal`, so the
   `worker` folder reaches 100 % (Phase 6 section 3 found it the last physics folder below).

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
