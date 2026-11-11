**Title:** A three class used only by lazy code ships in the first download

Status: open
Category: Smallest build, Merging
Found: 2026-11-11, p375 Phase 1 S6 (`docs/plans/p375_batched-mesh-batches.md`, "S6 results")
Our workaround: none; the budgets carry it (`sbp.config.ts`: `BatchedMesh`, +4.6 KiB gzip with `merging()`)

## What happens

three's build is two big modules (`three.core.js`, `three.webgpu.js`). Rollup tree-shakes their
statements, but keeps every statement it keeps in the chunk the module is in, which is the main
chunk: the renderer needs them. So a three class that only a lazy chunk names (`new
THREE.BatchedMesh` in `features/merging/MergeBatch.ts`, loaded behind `import()` on the first
batched group's build) is kept, and kept in the first download. `yarn sbp` after p375 Phase 1:
three 239.9 → 244.6 KiB gzip in `assets/index.js`, while `MergeBatch.ts` is a 2.7 KiB lazy chunk of
its own. Every app that lists `merging()` pays it, with or without a `BATCHED` group.

p372 met the same class through an `instanceof THREE.BatchedMesh` (`MergeEligibility.ts` reads
three's type flags since); p375 §1 assumed an `import()` would keep it out, which it can't.

## Fix idea

Resolve `three` and `three/webgpu` to three's sources for the build (`three/src/Three.Core.js`,
`three/src/Three.WebGPU.js`, aliased in `vite.config.ts` for production), so each class is a module
of its own and a class only lazy code names goes into that code's chunk. Needs its own plan: it
touches every three import (the workers' too), the `three` group's budget and the bundle baseline,
may change three's side effects (its `package.json` lists the node modules as side-effectful), and
could shrink the first download beyond `BatchedMesh` (whatever three's classes the app never names).
Check that `__THREE__`'s multiple-instance warning doesn't fire and that nothing mixes the build
and the sources.
