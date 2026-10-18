**Title:** An imported node's body is dropped silently when another node without an `index` has one

Status: open | for a physics or assets plan
Category: Physics, Assets
Found: 2026-10-18, p614 Phase 8 (checking the Hub's physics guide against `spawnImportedPhysics`)
Our workaround: give every body of a file its own `index` custom prop (the Hub's physics guide says so)

## What happens

`spawnImportedPhysics` (`features/physics/import/ImportPhysics.ts`) makes one rigid body per
`index` group, carried by the group's first node with a `rigidType`. The nodes without an `index`
form one group together. So in a file whose physics nodes have no `index`:

- only the first node with a `rigidType` gets a body;
- every other node with a `rigidType` is left out of the members (`!n.props.rigidType`), so it gets
  neither a body nor a collider, and nothing is logged. A visible one is still spawned as a mesh,
  so it looks right, but it never moves and nothing collides with it.
- the other physics nodes (colliders without a `rigidType`) all join the first body as compound
  members, wherever they are in the file.

No template asset has two bodies without an `index`, so nothing in the app shows it.

## What it would take

Either:

1. **Each node with a `rigidType` and no `index` is a group of its own** (a body with its own
   collider), and only the colliders without an `index` and without a `rigidType` join a body: but
   which one? With one body in the file, that one; with several, none (a warning naming the
   nodes). This keeps every file that works today working.
2. **Warn only:** a group with a second `rigidType` node logs a warning naming the import and the
   nodes left without physics, through the parse's `warnings` (`kernel/assets/import/CustomProps.ts`)
   or the spawn.

Either way a test in `import/` with a two-body file, and the Hub's physics guide ("From imported
models") updated.
