Ækasha is a high-performance WebGPU framework for the modern web. A modular ECS and a threaded
physics core make it the invisible medium where complex data turns into immersive, real-time 3D.
Four principles run through every feature:

- **Primordial performance.** Built for WebGPU from the ground up, with WebGL 2 as the fallback.
  The GPU is the primary canvas for logic and rendering, not a peripheral.
- **Modular infinity.** An ECS core with opt-in plugins and systems: you bring in only what you
  need, and nothing else ends up in the bundle.
- **Threaded reality.** Physics runs on its own thread, and assets can load and decode on theirs,
  so the frame keeps flowing.
- **Smallest build possible.** Every byte before the first frame is a wait: a build carries only
  what the app uses, the heavy parts load on first use, and
  [`yarn sbp`](hub:features/smallest-build) measures every build against its budgets, so a scene is
  light enough to embed in any page.

Each feature has a page here: how it works, its key APIs, and its example scene where it has one.
