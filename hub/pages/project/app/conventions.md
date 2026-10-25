## The app's folders

```text noLineNumbers
src/app/
  scenes/<sceneId>/   one folder per scene: its JSON, its scene file and what only it uses
  examples/<name>/    the Hub's example scenes, one per example page
  profiles/<id>/      an embed profile: its entry module and its scene
  shared/             code several scenes use
  textures/, skyboxes/, impostors/, postFx/, …
                      assets several scenes use, in their type's folder
```

`devTools/layout/layoutRules.ts` holds these as rules, so `yarn test` fails on a file anywhere
else.

### A scene's folder

`src/app/scenes/<sceneId>/` holds `<sceneId>.scene.json`, `<sceneId>.ts` (its `sceneFile`), its
`_dbg__` module, its `<sceneId>.hub.png`, its own modules, and the asset JSONs only it uses with
their sources. File and folder names follow the scene id, and **the id doesn't change**: it keys
the scene's `__saveData`, the scene runner's baselines, the saved debug state and `?startScene=`.

### Where an asset goes

An asset that only one scene uses lives in that scene's folder. "Only" means no other scene JSON,
scene file or asset JSON names its id. When a second scene starts using it, it moves to its type's
folder (`src/app/textures/`, `src/app/skyboxes/`, …). A moved asset JSON keeps its id, so the
scenes that name it don't change, but its `$schema` and its relative paths (`image`, `fileName`)
do. A scene JSON's `sceneFile` is relative to `src/app/`.

Code follows the same rule: code one scene uses stays in its folder, and code several use goes
to `shared/`. The ECS example's `SpinComponent` and `SpinSystem` are the exception. They stay
in `examples/ecs/`, where its page shows them, though another scene uses them too.

### Examples and profiles

- **`examples/<name>/`** are ordinary app scenes that the Hub's example pages include by region,
  so an example's scene file holds only the example. Changing one changes its page: run
  `yarn hub:build`, and save its Hub image again if it looks different.
- **`profiles/<id>/`** are the embed profiles of `sbp.config.ts`. Each has `<id>.embed.ts`, which
  binds the profile's generated data and exports `mount`, and its scene laid out like a scene
  folder. `banner` is the floor (one code-made scene, no feature), and `uiKit` is the UI kit in an
  embed.

## The app's version

`app_metadata.version` covers `src/app/` and the app-level files in `src/`. It's bumped once per
merge into `main` like the others, at the level of the biggest app change since the last merge,
and a major gets the next life stage as its codename (Toddler → Preschooler → Kid → Teen → …).
An app-only change never touches the project version, which is always the engine's. The rules
are on [Developing Ækasha](hub:project/aekasha#versions-and-the-changelog).
