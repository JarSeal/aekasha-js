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

## The app's design

The [app's design document](hub:project/app/design) says how its UI looks, moves and talks to its
players. In the template it's empty: each section says what to decide and starts from
[Ækasha's design document](hub:project/aekasha/design), since the app's HUD is built from the
UI kit and its tokens.

## The app's plans and issues

The app's plans go in `docsApp/plans/` and its issues in `docsApp/issues/`, next to Ækasha's
`docs/`. A project made from the template then keeps its own plans and issues apart from
Ækasha's, and takes Ækasha's updates to `docs/` without conflicts in its own files. In the
template both folders are empty.

They're written as Ækasha's are ([from a plan to a merge](hub:project/aekasha#from-a-plan-to-a-merge)),
with these differences:

- **What goes where:** a change to `src/app/` or the app-level files in `src/` is the app's. A
  change to the engine or the toolkit is Ækasha's, even when an app scene shows it. An issue goes
  with the code it's in.
- **Numbers:** the app's plans have a number space of their own, so an app `p100` and an Ækasha
  `p100` can both exist. The number is the priority within the folder.
- **References:** a header line names a plan in its own folder by file name, and one in the other
  folder by its repo path (`Blocked by: docs/plans/p302_material-and-texture-system-refactor.md`).
- **One way, as in the code:** an app plan can wait on an Ækasha plan, but an Ækasha plan never
  names an app plan in `Blocks`, `Blocked by` or `Epic`, so the app's plans never change
  Ækasha's files. The roadmap warns when one does.
- **Versions:** an app plan bumps `app_metadata.version`, and its changelog sections are the
  App's.

[The app's roadmap](hub:project/app/roadmap) lists its plans and open issues, in the same shape
as [Ækasha's](hub:project/aekasha/roadmap). The app's issues also get pages in the Hub's
[Issues](hub:issues) section, under a heading of their own. That section is public, so a project
that publishes its Hub publishes its app's issues too. The rules in full are in
[`docs/plans/CLAUDE.md`](repo:docs/plans/CLAUDE.md#the-apps-plans-and-issues).

## The app's version

`app_metadata.version` covers `src/app/` and the app-level files in `src/`. It's bumped once per
merge into `main` like the others, at the level of the biggest app change since the last merge,
and a major gets the next life stage as its codename (Toddler → Preschooler → Kid → Teen → …).
An app-only change never touches the project version, which is always the engine's. The rules
are on [Developing Ækasha](hub:project/aekasha#versions-and-the-changelog).
