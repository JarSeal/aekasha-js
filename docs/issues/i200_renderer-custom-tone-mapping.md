**Title:** The Renderer tab offers "Custom" tone mapping, which nothing provides

Status: open | to become a plan: an app's own tone mapping curve
Category: Rendering, Debug
Found: 2026-10-26, p804 Phase 0 (the event order probe)

The Renderer controls tab (`src/_engine/kernel/render/debug/_dbg__Renderer.ts`) lists every three
tone mapping constant, `THREE.CustomToneMapping` ("Custom", 5) among them. Picking it sets
`renderer.toneMapping = 5`, and on the next render three's node renderer logs
`THREE.ToneMappingNode: Unsupported Tone Mapping configuration. 5` and draws the colour without
tone mapping. `AppConfig`'s renderer options (`kernel/render/Renderer.ts`, `toneMapping:
THREE.ToneMapping`) accept the same value from an app, with the same result.

The cause: `ToneMappingNode` (three r186, `nodes/display/ToneMappingNode.js`) looks the constant up
in the renderer's node library (`renderer.library.getToneMappingFunction`), and three registers a
function for every constant but `CustomToneMapping` (`StandardNodeLibrary.js`,
`BasicNodeLibrary.js`). WebGLRenderer's way (replacing the `CustomToneMapping` shader chunk) has no
node renderer equivalent; the node renderer's is `renderer.library.addToneMapping(fn,
CustomToneMapping)`, a TSL function of the colour and the exposure node returning a `vec3`.

Proposed (a plan): let an app provide its own curve, for example a renderer option or a public
function that registers a TSL tone mapping function under `CustomToneMapping` when the renderer is
created (and again if it's recreated), so "Custom" means the app's curve; the Renderer tab shows
"Custom" only when one is registered. Until then, the tab could leave the option out. Check the
places that copy `renderer.toneMapping` into their own output (`Snapshot.ts`' `renderOutput`, the
viewports' `toneMapping: 'RENDERER'`, PostFX's output) render the custom curve the same way.

## three r187 (checked 2026-11-05, p057)

Unchanged: r187 still registers nothing for `CustomToneMapping` (`StandardNodeLibrary.js`,
`BasicNodeLibrary.js`), `ToneMappingNode` still logs "Unsupported", and
`renderer.library.addToneMapping` is the same (per renderer; `addType` keeps the first
registration and warns "Redefinition" on a second, so a curve is registered once per renderer and
can't be swapped without a new one). The built-in curves are now written in the layout form,
`Fn(fn, { color: 'vec3', exposure: 'float', return: 'vec3' })`: the form an app's curve takes. The
ACES Filmic fit's denominator was fixed (#35110), so ACES output changed with r187.
