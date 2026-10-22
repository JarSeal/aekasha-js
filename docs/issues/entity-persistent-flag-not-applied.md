**Title:** `persistent: true` on a camera, light or mesh entity doesn't keep it on a scene switch

Status: open | for the ECS's next review
Category: ECS, Scenes
Found: 2026-10-21, p619 §1.4 S8 (read from the code); again 2026-10-22, p620 §1.4 N3 (W4: the start scene's camera JSON set it)
Our workaround: none needed so far: no scene relies on it (p620 removed the one flag a JSON set). An entity that must survive a switch gets the `PERSISTENT` component itself, as the debug camera does

## What happens

`CoreEntityOpts.persistent` (`schemas/_HelperSchemas.ts`, on every camera, light and mesh JSON's
entity options) reads "keeps the entity on a scene switch". `ECSWorld.createEntity` doesn't add
the `PERSISTENT` component for it, so the scene switch's wipe (`ECSWorld`'s clear, which keeps
the entities that have `PERSISTENT`) deletes the entity anyway. Only `createLines` and a
directional or spot light's target entity read the flag. p619 documented it on the field
(`@remarks`, and the JSON Schema's description) and left the fix.

## Why it's not a one-line fix

Adding `PERSISTENT` in `createEntity` makes the flag work, and then a scene that sets it leaks:
`createCameras` and the lights and meshes of a scene's JSON are created on every visit, so each
visit adds another persistent entity with the same `appId`. p620's W4 was that case (the start
scene's `mainCamera.camera.json`). So the fix needs one of:

- the scene load skips a persistent entity whose `appId` is already live (and reuses it), or
- `persistent` leaves the asset JSONs' options (code only), where the caller decides once.

Either is a kernel behaviour change for the ECS's owner, with a changelog line.
