Status: draft | not-implemented
Category: Text, Debugger
Epic: p390_text-rendering-and-text-decals.md
Blocked by: p393_text-effects.md
Blocks: p399_text-showcase-scene-and-hub.md
Related: `src/_engine/ui/CLAUDE.md`'s Game UI (the world anchors: `ui/game/anchors/WorldAnchorLayer.ts`, `AnchorProjection.ts`; `toolkit/ecs/effects/WorldAnchorSync.ts`), `src/_engine/features/lines/CLAUDE.md` (leader lines, the per-frame refill pattern debug text copies), `src/_engine/debug/CLAUDE.md` (the debug overlays that get labels)

# Labels, Screen Text and Debug Text — Plan

Three uses of p392's texts that each need a little more than a text: **labels** over things in the
world, **screen text** that spawns and dies fast (damage numbers, pickups, nameplates), and
**debug text** drawn every frame by debug code. Plus the guide for when HTML world anchors are the
better label (the epic's D7).

## Design

### D1. Labels (`createLabel`, `createLabelEntity`)

A label is a text with preset defaults and two extras:

```ts
const label = createLabel({
  text: 'Supply crate',
  font: 'plexSans',
  target: crateId,                 // follows an entity (attach), or `position`
  offset: [0, 1.1, 0],             // metres, in world space above the target
  size: 14,                        // CSS px: labels default to SCREEN sizing, BILLBOARD
  plate: { color: '#000000aa', padding: [6, 3], radius: 4 }, // optional background
  occlusion: 'DEPTH',              // 'NONE' (always on top) | 'DEPTH'
  fade: { near: 2, far: 40 },      // opacity by distance (metres)
  leader: true,                    // a line from the plate to the target (needs lines())
});
```

- **The plate** is an SDF rounded rectangle in the same batch's graph (a variant bit: one extra
  quad per label, its distance computed analytically, no atlas), so a label is one draw with its
  text.
- **Distance fade** is in the vertex stage from the camera distance (a variant bit; the near / far
  in the row).
- **Leader lines** come from `lines()` when installed (one shared `FAT` line, refilled when a
  leader's ends move); without it `leader` is ignored with one log line.
- **Decluttering** (moving overlapping labels apart) is a non-goal (the epic's).

### D2. Screen text pools (`createTextPool`)

For text that appears and disappears many times a second:

```ts
const damage = createTextPool({ font: 'digitsDisplay', capacity: 64, size: 22, effects: { outline: { width: 0.2, color: '#000' } } });
damage.spawn({ text: '-42', position: hit, color: '#ff4040', rise: 1.2, lifetime: 900 });
```

- A pool is one batch with a fixed capacity: a spawn takes a free slot or the oldest (FIFO), writes
  its glyphs and row, and never allocates (the string's glyphs written straight from the code
  points; numbers formatted into a reused buffer by `spawnNumber(value, opts)`).
- The motion (`rise`, `drift`, `scale` over its life, the fade out) is in the vertex stage from the
  spawn time and the feature's time uniform: the CPU writes once per spawn.
- A pool is not an entity; it's disposed with its scene unless `persistent`.

### D3. Nameplates

A recipe, not an API: a label on a character with `orientation: 'BILLBOARD_Y'`, `SCREEN` sizing
with a `maxScale`, the distance fade, and a resource bar from the UI kit's world anchors when it
needs to be interactive. The Hub's guide shows it; the showcase has one per character.

### D4. Debug text (`drawDebugText`)

Immediate mode, for debug code only:

```ts
// in a _dbg__ module, every frame
drawDebugText(position, `v=${speed.toFixed(1)}`, { color: '#0f0', size: 12, onTop: true });
```

- `debug/_dbg__DebugText.ts` keeps one pool-like batch per frame (`FIXED` growth, capacity 4,096
  glyphs, the overflow dropped with one warning), cleared at `MAIN`'s start and drawn after
  `LATE_MAIN`, `plexMono`, `SCREEN` sizing, on top, an outline for contrast.
- Loaded through the debug loader like every `_dbg__` module, so a production build has none of
  it (`yarn verify:baselines`' debug check). Without `text()` installed it's a no-op with one log
  line, like the lines-based overlays.
- **First users:** an "Entity names" overlay toggle in the debugger (each entity's `APP_ID` or id
  at its position, the visible ones within a radius), the physics bodies' names and sleep states,
  the spatial cells' counts. Each a checkbox in its own tab, off by default.

### D5. HTML or MSDF: the guide

| Pick HTML world anchors when… | Pick MSDF labels when… |
|---|---|
| It's interactive (buttons, focus, hover) | It's only read |
| Screen readers must read it | It must hide behind walls (`occlusion: 'DEPTH'`) |
| It needs rich layout (icons, bars, mixed styles) | It must be in snapshots, PostFX or a viewport |
| A handful at a time | Dozens to thousands at once |
| It's a HUD element | It lives in the world (signs, damage numbers) |

Written on the Text page and in `ui/CLAUDE.md`'s world anchors note (a line pointing at it).

## Phases

### Phase 1: Labels

D1: `Label.ts`, the plate and fade variant bits, leaders; tests; the showcase's labels station
(labels on a static crate, a moving platform and a falling physics box, with offsets; occluded and
on-top side by side).

### Phase 2: Screen text pools

D2: `TextPool.ts`, `spawnNumber`; an allocation check with the `perf-auditor` agent; the showcase's
damage numbers on a target dummy (a click or a timer hits it).

### Phase 3: Debug text and its first overlays

D4: `drawDebugText`, the three overlays; their checkboxes; the debug-only proof in
`yarn verify:baselines`.

### Phase 4: The Hub and the docs

The Text page's Labels, Screen text and Debug text sections, D5's guide, the nameplate recipe;
`features/text/CLAUDE.md`'s sections and `aek:covers`; `debug/CLAUDE.md` (the overlays).

### Phase 5: Versions and done

On the `p390-text` branch's bump. `CHANGELOG.md`; mark the plan done. If p395 isn't built on the
branch, this is the time for the `p390-text` PR into `main` (the epic's Branches and PRs).

## Verification

`yarn test`; `yarn verify:scenes --only textShowcase` (the stations); a 1,000-label figure on the
showcase's measurement station against 1,000 HTML world anchors (frame ms, both moving), recorded
for D5's guide; `yarn verify:baselines` (no debug text in production).

## Non-goals

Decluttering, clickable MSDF labels (raycast picking of a label works through its entity, but no
hover states), localization (an app passes the translated string).
