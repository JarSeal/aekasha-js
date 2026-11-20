**Title:** On WebGPU the debugger's GPU frame time sums overlapping passes, and an empty shadow pass resolves with a stale timestamp

Status: open | the stale timestamp counted as 0 since p376 Phase 0
Category: Debug, Rendering
Found: 2026-11-12, p376 Phase 0 step 2 (largeWorld's GPU figure on WebGPU)
Our workaround: read the GPU time of the passes in question (three's render timestamp pool, by context), not the frame figure, when comparing on WebGPU; WebGL2's frame figure holds

## What happens

`_dbg__GPUFrameTimes.ts` gives a frame's GPU time as the sum of its render contexts' durations
(`_sumGpuMs`, `_dbg__GPUTimer.ts`), each from three's WebGPU timestamp pool (one begin and one end
timestamp per render pass). The stats panels' GPU figure and the profiler's GPU row read it. In
largeWorld (Apple M2, Chrome, 1600 × 900, the day-night sky at 10:00, `ambientOcclusion` on), two
things go wrong, found by reading each context's duration from the pool (p376's probe,
`src/app/shared/_dbg__hlodSpike.ts`, `gpuContextsAsync`):

| Context | Draws | Overview camera | Pulled back 2.5 × |
| --- | --- | ---: | ---: |
| `r:1` | PostFX output to the canvas | 9.15 ms | 3.90 ms |
| `r:2` | the scene pass | 4.73 ms | 3.17 ms |
| `r:3` | the sun's shadow map | 0.32 ms | **-3,460 ms** |
| `r:4`, `r:5` | the sky's 1024 targets | 0.73, 1.29 ms | 0.83, 1.29 ms |
| `r:6` | GTAO | 9.05 ms | 3.72 ms |
| `r:7` | the AO pre-pass | 4.66 ms | 2.79 ms |

(medians over 3 s)

1. **An empty shadow pass's timestamps are stale.** Pulled back, the camera is 300 m out and the
   sun's 60 m shadow frustum (which follows it) holds no caster. The shadow pass's duration then
   reads -2,000 to -5,000 ms, falling by the page's age: one of its two timestamps is from long
   ago, never written again. Not looked into in three (r187): whether the empty pass is begun
   without its timestamp writes, or its query slots aren't written for another reason. Since p376
   Phase 0, `_sumGpuMs` counts a negative duration as 0, so the frame figure is no longer negative
   (a stale timestamp that comes out positive would still be summed).
2. **The sum counts overlapping work twice.** The composite pass to the canvas (`r:1`) reads
   about what GTAO (`r:6`) does, though it only samples two textures: on a tile-based GPU, a pass
   that reads the previous one's output starts its interval before that one ends, so their
   intervals overlap. Summed, the frame reads 29 ms on WebGPU against 11.5 ms on WebGL2 (whose
   pool times one context at a time) for the same frame; the spread over runs was 24-31 ms.

## A way out

A frame's span instead of its passes' sum: the earliest begin to the latest end of its contexts.
three's pool hands only each context's duration (`timestamps`), so this needs the raw begin and
end values: a pool of our own over the backend's query set, or a patch of three's resolve that
keeps them. Until then the WebGPU frame figure is an overestimate, fine for watching a trend in
one view, not for comparing two configurations; a single pass's duration still compares.
