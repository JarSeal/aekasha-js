## The scene

<<< src/app/profiles/banner/banner.ts#banner-scene

The dodecahedron's geometry is made in code and registered with
[`saveBufferGeometry`](api:saveBufferGeometry), so the build needs no model loader. The camera,
the light and the material (a TSL gradient with a rim glow) come from the scene's JSON files
next to it. The scene has no background, so the page shows through the canvas.

## The profile

A profile is a build of its own, listed in `sbp.config.ts` at the repo root: its id, its entry
module, its scenes and its budgets. For a profile's scenes, the data pipeline writes
`src/generated/profiles/<id>/`, holding only those scenes, so the embed doesn't carry the rest of
the app's data. The first scene in the list is the one a mount starts with.

## The entry

<<< src/app/profiles/banner/banner.embed.ts#banner-embed

The entry binds what the site shouldn't have to know: the profile's data, its features (`[]`, the
kernel alone) and where its files are. In a build, `assetBaseUrl` is the entry's own folder, so
the embed finds its files wherever the site puts them. The site passes the rest of
[`mountAekasha`](api:mountAekasha)'s options.

## Building it

```sh
yarn sbp --profile banner
```

This builds the embed into `dist-embed/banner/`: `banner.embed.js` at its root, everything else
in `assets/`, and then measures it and checks its budgets (`yarn build` does the same for every
profile). Copy the folder into your site, for example as `/aekasha/`. The entry adds its own
stylesheet to the page, and loads its scene's code when it mounts.

## The page

The site gives the scene an element and a size. Here the scene fills the hero, behind its text:

<<< devTools/verify/embedExample.html#embed-example-markup

<<< devTools/verify/embedExample.html#embed-example-styles

Then one call mounts it, and the handle pauses and resumes it:

<<< devTools/verify/embedExample.html#embed-example-script

The canvas follows the element's size whenever it changes. The scene pauses while it's out of
view or the tab is hidden, and with `prefers-reduced-motion` it renders once and waits for
`resume()`.

## The options

The ones a site sets (see [`MountAekashaOptions`](api:MountAekashaOptions) for all of them):

| Option            | Default       | What it does                                                                                            |
| ----------------- | ------------- | ------------------------------------------------------------------------------------------------------- |
| `target`          | (required)    | The element, or a selector for it. The mount adds its own container inside and changes nothing else.    |
| `width`, `height` | `'100%'`      | Any CSS length: `'40rem'`, `'60vh'`, `'calc(100% - 2rem)'`.                                             |
| `layout`          | `'INLINE'`    | `'BACKGROUND'`: fixed to the viewport, behind the page's content, without pointer events.               |
| `sceneId`         | the first one | The scene to start with, from the profile's scenes.                                                     |
| `input`           | `'NONE'`      | `'CANVAS'`: the pointer on the canvas, and the keys while it has focus. The page's input stays its own. |
| `pauseWhenHidden` | `true`        | Pauses while the container is out of view.                                                              |
| `reducedMotion`   | `'RESPECT'`   | `'IGNORE'` runs it even with `prefers-reduced-motion`.                                                  |
| `fallbackImage`   | none          | Shown until the first frame, and instead of the scene without WebGPU or WebGL2.                         |
| `canvas`          | none          | The canvas's id, classes and inline styles.                                                             |

[`AekashaMount`](api:AekashaMount), the handle, has `loadScene`, `pause`, `resume`, `isPaused`
and `unmount`, and `isFallback` when the scene couldn't start: then the container shows
`fallbackImage`, and the methods do nothing.

## The limits

- **Same origin.** Serve the embed's folder from the site's own origin. Its workers (the assets
  worker, and physics in a profile that has it) are module workers, which a browser starts only
  from the page's origin, so an embed on another origin (a CDN) isn't supported.
- **One engine per page load.** A second `mount()` throws, also after `unmount()`.
- **Physics without `SharedArrayBuffer`.** A site that doesn't send the COOP and COEP headers has
  none; physics then sends its state once per frame instead, which works, a little slower.
- **`BACKGROUND` sits behind the page's content,** in the page's root stacking context: a
  background on `body` doesn't hide it, but backgrounds on both `html` and `body` may.
- **The HUD is the full-page app's.** Its windows and texts are sized for the template's root
  font size: an embed that shows the HUD gets them larger.

## Your own profile

1. Make the scene in a folder under `src/app/profiles/<id>/`, as the banner's: its scene JSON,
   its scene file and the assets only it uses.
2. Write the entry, `<id>.embed.ts`, as the banner's: its data from
   `src/generated/profiles/<id>/`, the features it installs, and `assetBaseUrl` from
   `import.meta.url`.
3. Add the profile to `sbp.config.ts`: `id`, `entry`, `scenes` and, once you've measured it,
   `budgets`.
4. Build and measure it with `yarn sbp --profile <id>`.

::: dev-only Check an embed
`yarn verify:embed --profile <id>` mounts the build into a plain page in Chromium, `INLINE` and
`BACKGROUND`, and fails when the canvas doesn't follow its container, the page's styles change,
or anything logs an error. The banner's run also loads this page's example. The dev server
doesn't tree-shake, so an embed it serves brings the full-page app's styles: check embeds against
a build.
:::

Back to the [examples](hub:examples).
