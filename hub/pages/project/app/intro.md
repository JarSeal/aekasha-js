The repo is a template: the engine, the toolkit and one app built on them. The app is the example
app today (`app_metadata` in `package.json`), and in a fork it's the game. It's `src/app/` plus the
app-level files in `src/`: `index.ts` (the entry, which calls [`InitEngine`](api:InitEngine)),
`CONFIG.ts` (its configuration), `AppECSPlugins.ts` (its ECS plugins, listed last in `features`)
and `AppECSRegistry.ts`. `src/generated/` is the gatherer's output, written from the scene and
asset JSON files: never edit it.

The app follows the same [coding standards](hub:documentation/coding-standards) as the engine.
It imports the engine and the toolkit only through their entries (`aekasha`,
`aekasha/physics`, `aekasha/toolkit/ecs`, …), and the lint fails on a path into either.
[Where your feature goes](hub:documentation/architecture#where-your-feature-goes) says which
layer a new piece belongs in. This page covers what's specific to the app's own folder.
