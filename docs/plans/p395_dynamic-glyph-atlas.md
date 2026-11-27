Status: draft | feasibility study — not-implemented
Category: Text, Assets
Epic: p390_text-rendering-and-text-decals.md
Blocked by: p391_font-assets-and-msdf-font-tool.md (its Phase 1 decides the generator), p392_text-feature-msdf-renderer.md
Related: `src/_engine/kernel/init/CLAUDE.md` (the assets worker and its lazily imported jobs), `devTools/sbp/CLAUDE.md` (the lazy chunk's budget)

# The Dynamic Glyph Atlas — Plan

Text the build can't know (player names, chat, user content, a language added later) needs glyphs
that aren't in the static atlas. Unity's TextMeshPro and Godot both solve it with a dynamic atlas
that renders missing glyphs at runtime from the font file. This plan studies and, on a go, builds
the same: a font with `dynamic: true` ships its (subsetted) source font, and a missing glyph is
generated in a worker and added to the atlas while the text draws its fallback for a frame or two.

## Design (to confirm in Phase 1)

### D1. What ships

- The static atlas and layout (p391), plus the source font as a lazy asset
  (`<id>.source.ttf`, subset to the scripts the font's `dynamic.scripts` lists: `LATIN`,
  `GREEK`, `CYRILLIC`, `CJK`; subsetting with `subset-font` (HarfBuzz' subsetter) at encode time).
- The generator: p391's choice if it runs in a browser worker (WebAssembly or the TypeScript
  port), as a job of the assets worker `import()`ed on the first dynamic glyph (its own chunk),
  plus the font parser.
- Nothing of it in a build whose fonts are all static.

### D2. The flow

1. Layout meets a code point the font lacks: a dynamic font queues it (once), the text draws the
   fallback.
2. The worker parses the source font once, generates the queued glyphs' MTSDF tiles and metrics,
   and sends them back (transferables).
3. The main thread packs each tile into the atlas' free space (a skyline packer over the page),
   uploads the rect (`texSubImage` / `writeTexture` through three's texture update ranges), adds
   the glyph to the font's map, and marks the texts that wanted it dirty.
4. A full page adds another page: the atlas becomes a 2D array texture (a page per layer; the
   glyph's `atlasRect` gains a layer), so the graph reads with a layer index (a variant bit:
   only dynamic fonts pay it).

### D3. Limits

Pages up to `dynamic.maxPages` (default 4 × 2048²). When full, the least recently used dynamic
glyphs (never the static ones) are evicted and their texts relaid out. Kerning for dynamic glyphs
comes from the source font's `kern` / `GPOS` pairs read by the worker.

## Phases

### Phase 1: The spike (go / no-go)

1. Run p391's generator in a browser worker: the time to generate 1, 50 and 500 glyphs (Latin and
   CJK) on the dev machine and a mid-range phone, the chunk's size (minified and gzipped), the
   source font's size subset to Latin, Cyrillic and a common CJK set.
2. **Go** when a glyph costs under 2 ms in the worker, the chunk is under 300 kB gzipped, and a
   one-page update doesn't hitch the frame (measured with the profiler). **No go:** record the
   figures here, keep static atlases, and move the idea to p990 with the figures.

### Phase 2: The worker job and the atlas pages

D1-D2: the job, the packer, the uploads, the array pages and their variant bit; tests on the packer
and the font map's growth.

### Phase 3: Eviction and the debug tab

D3; the Text tab shows a dynamic font's pages, its queued and evicted glyphs.

### Phase 4: The showcase and the Hub

A "type your name" station in `textShowcase` (a UI kit text field writing into a world text with
Latin, Cyrillic and a few CJK characters); the Text page's Dynamic fonts section;
`features/text/CLAUDE.md`.

### Phase 5: Versions and done

On the `p390-text` branch if it's still open, else its own branch (engine minor, app minor).
`CHANGELOG.md`; mark the plan done.

## Verification

Phase 1's figures; `yarn test`; `yarn sbp` (the chunk is lazy: nothing before the first frame);
the showcase's station on WebGPU and WebGL2.

## Non-goals

Shaping (the epic's Risks 3), colour emoji, generating static atlases in the browser.
