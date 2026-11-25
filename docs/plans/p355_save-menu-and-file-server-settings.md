Status: in progress | Phases 1-8 implemented
Category: Debug, Dev tooling
Related: `devTools/devFiles/CLAUDE.md` (the dev file server this builds on, p342: the routes,
`writeDevFiles`, save entry writes, the "File server" folder; this plan is p342's §5 question 4),
`src/_engine/debug/editors/CLAUDE.md` (the material editor's per-material record, p084-p085: the
overrides this plan saves), _DONE_p150_current-entity-data-source-info-on-edit-windows.md
(origin info on the same camera and light data)

# Save Menu and File Server Settings

The debug tools keep every edit in localStorage: a light's colour, a sky box layer, a PostFX
pass, a material in the material editor. Nothing writes those edits back to the asset JSONs,
so a developer copies values by hand. p342 gave the browser a way to write files and `__saveData`
entries; this plan uses it:

- **The Æ menu:** the Æ button opens a menu with "Save scene" (Ctrl+S), "Save specific data…"
  (Ctrl+Shift+S) and "About Ækasha". "Save scene" saves the current scene's changes and the
  global ones in one write. "Save specific data…" lists them, and the other scenes' changes,
  with a checkbox each.
- **File server settings** (p342 §5 question 4): a toast with how a write's gather went,
  confirming writes before they land, the server's backup count, and an author stamp in save
  entries.

Everything it draws is the UI kit's (`aekasha/ui`, `src/_engine/ui/CLAUDE.md`): the menu, the
dialog, the checkboxes, the form, the spinner, the toasts and the File server folder's property
grid rows. Line numbers below are as of 2026-11-04 and move; the names don't.

---

## 1. Grounding

- **The Æ button** (`debug/_dbg__OnScreenTools.ts`) opens the About dialog
  (`openAboutDialog`, `debug/_dbg__About.ts`) directly. It's a kit ghost icon button in the top
  left row's first toolbar (`onScreenTopLeftRow`: the About and undo / redo group, a
  `createButtonGroup` toolbar), debug env only (prod test mode has no such group), and stays
  visible in editor views.
- **The kit's menu** (`createMenu`, `ui/overlays/Menu.ts`, the APG menu button): an `anchor`
  (the trigger: any button), `items` (or a getter read on every open) of actions (`label`,
  `onSelect`, `icon`, `kbd`: a `createKbd` hint with its `aria-keyshortcuts`, `disabled`) and
  `type: 'separator'`, roles `menu` / `menuitem`, the arrows, Home / End and typeahead, Escape
  through the overlay stack, the focus back on the trigger. A disabled item is `aria-disabled`,
  focusable, and picks nothing; an item has no tooltip or reason text.
- **`createDropDown`** (`ui/forms/DropDown.ts`) is a select (a current value, options); its
  `setDisabled(isDisabled, reason?)` closes an open list and makes the reason the trigger's title.
  A kit button has the same (`setDisabled(disabled, reason?)`, with `focusableWhenDisabled` a tab
  stop with the reason as its tooltip) and `setLoading(isLoading)` (the text faded into a
  spinner, `aria-busy`, clicks ignored).
- **Key bindings:** the debug keys (`debug/DefaultDebugKeyBindings.ts`) are action maps in the
  `DEBUG` context (`aek:debugKeys`; `src/_engine/debug/CLAUDE.md`), so they run in every view
  and stop during a scene load. Undo/redo are `KEY_DOWN` with Ctrl and ⌘ chords, the pattern
  Ctrl+S needs (the browser's "Save page as"). The maps prevent their keys' defaults only outside
  a text field, and undo/redo do nothing in one (the field's own undo works).
- **Dialogs:** `openDialog` (`ui/overlays/windows/DialogWindow.ts`): modal, `closeOnEscape`, a
  focus trap, the focus back on the opener. The kit has the checkbox (`createCheckbox`, with
  `setIndeterminate` for a group's heading box), the fieldset and the form (`createForm`:
  validation with the error summary, a busy submit: `aria-busy`, the submit button loading, a
  submit meanwhile ignored); the form has no form-level error yet (a failed save not tied to a
  field). Toasts: `addToast` (the debug toaster, debug env only).
- **p342's write side:** `writeDevFiles` (`debug/DevFiles.ts`) commits a batch all or nothing; a
  `saveData` write puts its entry first in `__saveData[sceneId]`, stamps `__meta` and keeps
  `getDevFilesSaveHistorySize()` entries. It replaces, it doesn't merge: the new entry must
  carry everything the latest one had. Each batch is one gather and one page reload. The
  server keeps the last 20 commits' backups (`BACKUPS_KEPT`, `devTools/devFiles/commit.ts`).
- **`MetaSchema`** (`schemas/_SaveDataSchema.ts`) has `date` and the three versions, no `author`.
- **git in the dev tools** goes through `devTools/git.ts` (`git(args)`, which throws, and
  `readGit(args)`, '' without git or a repo; synchronous `execFileSync`).
- **The gather's event:** `aek:gather` (`AEK_GATHER_EVENT`, `DevDataGatheredEvent` in
  `debug/DevFilesProtocol.ts`: `done` / `failed`, the changed files, the asset errors,
  `willReload`), delivered by the dev files' `onDevDataGathered` (`devTools/gather/CLAUDE.md`).

### What the debug tools keep (localStorage)

| Store                                                      | Asset                         | Scope             | Stored as                                                                                                                    | Saves into                                                        |
| ---------------------------------------------------------- | ----------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `AEK_debugSkyBox` (`features/skybox/debug/_dbg__SkyBoxShared.ts`) | `*.skybox.json`        | scene, sky box id | deviation-only `SkyBoxOverrides`, a delta over the def **with the latest entry merged in**                                   | `__saveData`, no conversion                                       |
| `AEK_debugPostFx` (`features/postfx/debug/_dbg__PostFX.ts`) | `*.postFx.json`              | scene, pass id    | deviation-only `{ enabled?, params? }` over the authored snapshot (latest entry included)                                    | `__saveData`, no conversion                                       |
| `AEK_debugCams` (`kernel/camera/debug/_dbg__CameraDebugState.ts`) | `*.camera.json`        | scene, appId      | full values (every edited key), plus UI keys (`helperVisible`, `_lensSettingsOpen`) and `debugCam`                           | `__saveData`, strip and diff                                      |
| `AEK_debugLights` (`kernel/light/debug/_dbg__LightDebugState.ts`) | `*.light.json`         | scene, appId      | full values, plus UI keys and `globalHelpersVisible`; colours as hex numbers; every record has `enabled: true`               | `__saveData`, convert and diff                                    |
| `AEK_debugMatEditorMat_<id>` (`debug/editors/material/_dbg__MaterialEditorStore.ts`) | `*.material.json` | **global**        | deviation-only `overrides: { params, nodes, inputs }` against the raw material JSON (plus editor `settings` and `camera`, not saved) | `__saveData` of the current scene, if its JSON lists the material |
| `AEK_debugPostFxSettings` `postFxEnabled[sceneId]` (`_dbg__PostFX.ts`) | scene JSON `postFxEnabled` | scene             | deviation-only boolean                                                                                                       | scene `__saveData` (Phase 7)                                      |
| `AEK_debugSpatialGrid` `domains[id].cellSizeByScene` (`features/spatial/debug/_dbg__SpatialGridSettings.ts`) | scene JSON `spatialDomains[]` | scene             | full value                                                                                                                   | scene `__saveData` (Phase 7)                                      |
| `AEK_debugCharConfig` (`features/character/debug/_dbg__CharacterConfigOverrides.ts`) | none (characters are code) | scene, character  | deviation-only                                                                                                               | not saved (characters come later)                                 |

Not saved (config or tool settings, CONFIG.ts is code): renderer options, physics world
settings, world-scope spatial cell size, PostFX `measureEnabled`, every UI state key. Nothing
persists edits of meshes, geometries, textures, imported assets or LOD.

- **Source files:** `getGeneratedAppData()` (`kernel/scene/Scene.ts`; dev data) keeps the registries (`cameras`, `lights`,
  `materials`, `skyboxes`, `postFx`, …) with `__sourcePath` and every `__saveData`. Cameras and
  lights are keyed by appId. A camera, light or sky box made in code, or written inline in a
  scene JSON, has no file of its own.
- **A material's entry is applied only through a scene JSON's `materials` list** (the gather
  resolves each listed id with that scene's entry: `resolveMaterials` in
  `devTools/gather/sceneAssets.ts`). In the dev data: `sceneTestECS` lists `testTslMat`;
  `thirdPersonGymScene` and `topDownTestScene` the two triplanar ones (`triplanarGrid`,
  `triplanarCheckerboard`); `space` `asteroid`; `lodShowcase` `lodShowcaseSphere`; the Hub's
  examples (`src/app/examples/`) `asteroid` and the triplanar ones; the other scenes none.
- **Scene JSONs:** the gather applies a scene's own latest `__saveData` entry (p619 G5,
  `resolveScene` in `devTools/gather/scenePass.ts`) and drops `__saveData` from the output, but
  the dev data has no `__sourcePath` for a scene (only the asset registries get one,
  `devTools/gather/registries.ts`), so the browser can't name the scene JSON's file. None of the
  app's scenes has a `__saveData` today.
- **Undo/redo** names the asset of most actions (appId, skyBoxId, postFxPassId, materialId and the
  scene's bucket), but is trimmed, drops its redo tail and misses some edits (helper toggles, the
  cell size): not a changes list.

## 2. Design

### 2.1 Save sources

`debug/SaveData.ts` → `debug/_dbg__SaveData.ts`, the usual split (`src/_engine/debug/CLAUDE.md`:
the thin module keeps what's registered before its implementation loads and hands it over, as
`UndoRedo.ts` and `Profiler.ts` do). Each debug module that keeps asset edits (a `_dbg__` module,
the only kind that may register at its load) registers a source:

```ts
registerSaveSource({
  id: 'skyBox',
  label: 'Sky boxes',
  /** Every unsaved change, of every scene in localStorage and every global one */
  collect: () => SaveChange[],
  /** After the commit: drop what was saved from localStorage */
  onSaved: (changes: SaveChange[]) => void,
});

type SaveChange = {
  id: string; // unique per source, eg. `${sceneId}:${skyBoxId}`
  label: string; // 'Sky box "dayNight"'
  scope: 'SCENE' | 'GLOBAL';
  sceneId?: string;
  /** Repo-relative; null with `unsaveable` when there's no file */
  path: string | null;
  unsaveable?: string; // why: 'made in code', 'not in this scene', 'id taken by <path>'
  /** An inline asset's extraction (§2.6): the new file and the scene JSON's edit */
  extract?: { newPath: string; scenePath: string };
  /** What changed, for the dialog: 'atmosphere.turbidity, suns.0.elevation' */
  summary: string[];
  /** Builds the write from the file as it is now (read just before the commit) */
  build: (file: { json: unknown }) => { saveData: DevFilesSaveData } | { json: unknown };
};
```

- **Fresh reads:** saving reads every target with `readDevFile` and passes its hash as
  `expectedHash`, so a file edited since makes the batch fail with `CONFLICT` instead of losing
  that edit.
- **Merged entries:** a scene change builds its entry from the file's latest
  `__saveData[sceneId][0]` with the debug delta merged in, by its type's merge rule (the
  gatherer's: flat for cameras and lights, `params`, `nodes` and `inputs` one level deeper for materials
  and PostFX, deep for sky boxes, where a whole list replaces). Then it drops every value that
  equals what the asset gives without the entry, so entries hold only real overrides. An entry
  left empty isn't written.
- **Global changes** write into the asset's own values (a `json` write of the file with the
  keys set), not `__saveData`: they aren't bound to a scene. The scope is in the API for later
  sources; no source in this plan has one.
- **Materials (for now) save only into the current scene, and only the ones it lists.** The
  material editor's edits aren't bound to a scene, but its source reports them as changes of
  the current scene: one per material in the scene JSON's `materials` list, saved as that
  scene's `__saveData` entry (its latest entry with the editor's `params` / `nodes` / `inputs` merged in,
  one level deep), so the save shows where the gather applies it. A material the scene doesn't
  list is Not saveable ("not in this scene") and keeps its editor changes; it's never in
  "Other scenes" either. Later the material editor will edit only the current scene's materials
  (and import one into the scene), its own work; then this rule just holds.
- **One write per file:** a batch takes each path once. Changes to the same file are folded
  into one write (two entries for one scene are merged). A file that would need both a
  global and a `__saveData` write fails the collect with a message (no source does that now).
- **After a commit** each source's `onSaved` removes the saved values from localStorage before
  the reload: the JSON has them now. Cameras and lights keep their UI keys. Undo history is kept:
  undoing a saved edit makes it an unsaved change again.
- **Inline assets** (a camera, light or sky box written in a scene JSON) are saved by moving them
  into a JSON file of their own (§2.6), not as Not saveable.
- **Characters** aren't saved: no source, not listed (their saving comes with the later character
  work; the state window's "Copy changes" stays).
- **What's saved:** "Save scene" saves the current scene's saveable changes and every global
  one. Unsaved material edits it can't save (materials not in the scene) get a warning toast
  naming them: 'Not saved: "rock", "bark" aren't in this scene's materials (they keep their
  editor changes)'. Other scenes' changes stay. In an editor view the scene is the suspended
  runtime one.

### 2.2 The Æ menu

The Æ button opens a menu (title "Ækasha menu") instead of the About dialog:

| Item                | Hint         | Does                |
| ------------------- | ------------ | ------------------- |
| Save scene          | Ctrl+S       | §2.1, at once       |
| Save specific data… | Ctrl+Shift+S | the dialog (§2.3)   |
| (separator)         |              |                     |
| About Ækasha        |              | `openAboutDialog()` |

- **The kit's menu:** `createMenu({ anchor: <the Æ button>, items: () => [...], label })`,
  the items a getter so their disabled states are read on every open; the hints are
  `createKbd` handles from the save keys' chords (`getDebugKeyChordLabel`: CONFIG.ts'
  rebinding); the separator a `type: 'separator'` item. The Æ button gets `aria-haspopup` and
  `aria-expanded` from the menu, and stays in its toolbar (one tab stop, the arrows inside).
- **A disabled item's reason:** the kit's action item has `disabled` but no reason. Add one to
  `MenuActionItem` (eg. `disabledReason`: its tooltip and its `aria-describedby`, read like the
  button's `focusableWhenDisabled` reason), with its test, its component library demo and the
  kit's `CLAUDE.md` line (`src/_engine/ui/CLAUDE.md`'s Writing a component).
- **Disabled save items**, with the reason as their tooltip, read when the menu opens:
  - **Saving disabled** disables both: the dev files unavailable (the `getDevFilesStatus`
    reason) or the save history size 0 (saving off, p342). 0 turns off every save of the menu,
    also a later global one that writes no `__saveData`: one rule, "0 = saving off", is easier
    to trust than one per kind of write. Revisit when the first global source comes.
  - **Nothing saveable in this scene** (and no global change) disables "Save scene". "Save
    specific data…" stays on while another scene has a saveable change, and is disabled when
    no scene has one.
- **While saving**, the Æ icon turns into a spinner and the menu is disabled (an open menu
  closes, the trigger can't open it, its tooltip says "Saving…"):
  - It starts when a save starts (the collect and the file reads) and ends when the commit
    fails, or when nothing was written (every file `unchanged`: no gather follows). After a
    commit that wrote files it stays until the reload; if the gather fails instead (the
    `aek:gather` event with `failed`, no reload), it ends then. A 30 s timeout ends it if no
    event comes (a dev server restarted meanwhile).
  - The save keys do nothing meanwhile but a toast ("Saving…"), so a held or repeated Ctrl+S
    is one save.
  - The spinner is the kit's: the Æ button's `setLoading(true)` (its icon faded into the
    button's spinner, `aria-busy`, clicks ignored; under `prefers-reduced-motion` it pulses), or
    a `createSpinner` in the icon's place. No new icon.
  - The menu off: `menu.close()` and the button's `setDisabled(true, 'Saving…')` (it stays a tab
    stop with the reason: `focusableWhenDisabled`, as the on-screen tools' buttons are).
- **Keys:** `sc-save-scene` (Ctrl+S, ⌘S) and `sc-save-specific` (Ctrl+Shift+S, ⌘⇧S),
  `KEY_DOWN`, category `DEBUGGER`, rebindable through `debugKeys`. They always
  `preventDefault` (the browser's save dialog is never wanted), also in a text field: they blur
  it first, so a typed value is committed before the collect (the kit's text and number fields
  write on a blur). The debug key maps leave a text field's keys alone (§1), so the save keys
  take that case themselves (a capture `keydown` for their chords while a field has the focus,
  or a map option for it). A key on an unavailable save (disabled, by the same rules) shows the
  reason as a toast. They work in every view.

### 2.3 "Save specific data…" dialog

`openDialog` with `closeOnEscape`, id `aekSaveSpecific`:

- Grouped rows, each group with a heading checkbox for its rows:
  - **This scene** (`<scene name>`), checked by default;
  - **Global** (empty in this plan, not shown), checked by default;
  - **Other scenes**, a sub-heading per scene (its name, else its id), unchecked by default:
    the changes localStorage keeps for scenes visited before (sky boxes, PostFX, cameras,
    lights, scene JSON entries). A scene that no longer exists in the generated data is Not
    saveable ("scene not found");
  - **Not saveable**: greyed, no checkbox, with the reason (made in code, a material not in
    this scene, an inline asset whose new file or id is taken).
- An inline asset's row says what its save does: "moves to
  `src/app/scenes/topDownTestScene/topDownTestSky.skybox.json`" under its path.
- Built on the kit: the groups as fieldsets, each row a `createCheckbox` (a group's heading box
  `setIndeterminate` while some of its rows are checked), inside a `createForm` whose busy submit
  is the Save button (§1).
- A row: a checkbox, the label, the file path and the summary (the changed keys, folded after
  five).
- Buttons: **Check all**, **Uncheck all**, **Save (n)** (disabled at 0) and **Cancel**.
- While its save runs, the Æ spinner shows (§2.2) and the dialog's buttons and checkboxes are
  disabled.
- Save commits the checked changes as one batch, as "Save scene" does. Another scene's entry is
  built the same way, from that file's latest entry for that scene; the delta it merges was
  measured against the same entry (the debug tools diff against the def with the scene's
  entry applied). The dialog stays open
  on an error (the code and message under the buttons), and closes on success (the reload
  follows). That error is a form-level one, which the kit's form doesn't have yet (§1): add it
  to `createForm` (a message in its error summary not tied to a field, with its test and demo),
  or keep it the dialog's own `role="alert"` line; decide in Phase 4.
- It's its own confirmation: a confirm-writes dialog (§2.4) isn't shown after it.

### 2.4 File server settings

All in the "File server" folder (Debug tools tab, `debug/_dbg__DebugToolsFolders.ts`: property grid rows) with a CONFIG default, as the save history size
(`AppConfig.devFiles`, overridden per browser by `debugToolsState.devFiles`, saved only once
changed):

1. **Gather toasts** (`gatherToasts`, default true): after a write from this page, a toast with
   how its gather went. `writeDevFiles` remembers the paths it wrote for 60 s; an
   `aek:gather` event whose `files` has one of them is this page's.
   - `done`: the reload comes next, so the listener writes a note to sessionStorage
     (`AEK_devFilesGatherNote`; the reload waits up to 2 s for the listener's promise: `devTools/devFiles/CLAUDE.md`'s API) and the debug
     init shows the toast after the reload: "Saved 4 files" with the list, a warning with the
     asset errors when there are some.
   - `failed`: an alert toast at once with the message (no reload; the overlay shows).
   - Gathers set off by an editor save stay as they are (no toast).
2. **Confirm writes** (`confirmWrites`, default false): `writeDevFiles` first asks the server for
   a dry run (`POST commit` with `dryRun: true`: every check, no write; per file its status and
   current hash), shows the files with created / updated / unchanged in a dialog, and commits
   only on Confirm, with the dry run's hashes as `expectedHash` (what was confirmed is what's
   overwritten). Cancel rejects with the client code `CANCELLED`. Every tool's writes go through
   it, the save menu's too; the "Save specific data…" dialog skips it.
3. **Backups kept:** a server setting, so an env var: `AEK_DEV_FILES_BACKUPS` (commits, default
   20; -1 keeps all, 0 keeps none: a commit's backups are removed once it landed, a failed one
   still restores from them). `GET status` gets `backupsKept` and `backupDir`; the folder shows
   them read-only.
4. **Author stamp:** the server stamps `__meta.author` in every save entry with git's
   `user.name` (`readGit(['config', 'user.name'])`, `devTools/git.ts`, read on each commit, so a
   change applies at once). Without git, outside a repo, or with no `user.name` set, `author` is
   undefined: the key is left out, also when the entry had one (the server's stamp always wins,
   as with the versions). `MetaSchema` gets `author: z.string().optional()`. `GET status` gets
   `author` (null when undefined) and the folder shows it ("none (git user.name not set)").

### 2.5 Scene JSON entries (Phase 7)

To save `postFxEnabled` and a scene's spatial domain cell size, the gatherer already applies a
scene's own `__saveData[sceneId][0]` (§1); what's missing is `__sourcePath` on the scene in dev
data (production keeps none: `resolveScene` deletes it there). The cell size becomes a
`spatialDomains` entry (`{ id, cellSize }`, merged by id into the latest entry's list: today a
scene entry's fields replace the scene's, so a list replaces the whole list, and the gatherer's
merge of `spatialDomains` by id is part of this phase).

### 2.6 Inline assets to JSON files (Phase 8)

A camera, light or sky box written inline in a scene JSON (`cameras` / `lights` / `skyboxes`
entries that are objects, not ids) has no file for a `__saveData` entry, and the gather ignores
an inline asset's own `__saveData`. Saving its changes moves it out:

1. **The new file:** `src/app/scenes/<sceneId>/<id>.<camera | light | skybox>.json`, in the
   scene's folder, since only that scene uses it (the app's layout, p609 D2: an asset a second
   scene starts using moves to its type's folder, `src/app/<type>/`), with the inline object as
   it is (its `$schema` relative to the new place) and the changes as its `__saveData[sceneId]`
   entry. The folder is the scene JSON's own (`__sourcePath`, §2.5). The id is the sky box's `id`,
   the camera's or light's `appId` (an inline one without an appId has no saved debug edits,
   so it never gets here).
2. **The scene JSON:** the inline object in its list replaced with the id, in place (the order
   of a list is kept; the gather resolves the id from the registry, where the new file's
   basename and `appId` / `id` both give it).
3. **One batch** with both writes (and the rest of the save), so the asset never exists twice
   or not at all: the new file with `expectedHash: null` (it must not exist yet) and the scene
   JSON with the hash it was read with.

- **Taken:** a file already at the new path, or the id already in the registry (another file
  has it), makes the change Not saveable with the reason ("id taken by
  `src/app/scenes/largeWorld/largeWorldSun.light.json`"); nothing is renamed automatically.
- **Server:** a write gets `json` and `saveData` together: `json` is the file's content and
  `saveData` is applied over it as over a read file (stamped, history size), so the new file's
  entry is stamped like any other. `saveData` alone still needs an existing file.
- **Two scenes, one inline asset:** an asset inline in one scene JSON belongs to that scene
  only, so the move never touches another scene. A second scene with an inline asset of the same
  id is "id taken" once the first one moved (the first save's file is in the registry after the
  gather).
- Materials and PostFX passes can be inline too, but their debug edits (the material editor,
  `AEK_debugPostFx`) exist only for registry assets, so they have nothing to move.

## 3. Phases

### Phase 1 — Server: author, backups, dry run — done

§2.4 items 2 (the server side), 3 and 4: `__meta.author`, `AEK_DEV_FILES_BACKUPS`, `dryRun`,
the new status fields, `MetaSchema.author`.

**Exit:** the self-check covers the author, an entry's own `author` replaced or removed, a dry
run that writes nothing and reports the statuses and hashes, and backups kept per the env var (0
keeps none, the forced rename failure still restores). It never touches the developer's git
config: its own server's `git` inherits the process env, which it switches between commits
(own-server mode only). Set: `GIT_CONFIG_COUNT=1`, `GIT_CONFIG_KEY_0=user.name`,
`GIT_CONFIG_VALUE_0=Self Check`. Unset: `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` pointed at an
empty file and `GIT_DIR` at an empty folder (no repo config either).

As built:

- Every commit result has `previousHash` (the file's hash before the write, null: none), not a
  dry-run-only field: a dry run's `previousHash` is the `expectedHash` of the commit it confirms
  (`currentHash` stays the conflict details' "on disk now"). `sha256` is the hash after the write,
  a dry run's what it would be. A dry run keeps its staged files. `commitDevFiles` returns
  `isDryRun`; the server logs `dry run:` instead of `commit:`.
- `AEK_DEV_FILES_BACKUPS` is read once at the plugin's start (as the other `AEK_DEV_FILES_*`),
  passed to `commitDevFiles` as `backupsKept`; an invalid value warns and keeps 20
  (`parseBackupsKept`). `GET status`'s `backupDir` is `.cache/dev-files/backup/`.
- The stamp (versions and author) is read once per commit (`readSaveDataStamp`,
  `devFiles/saveData.ts`); `readGitAuthor` is shared with `GET status`.
- The self-check's own server runs with `AEK_DEV_FILES_BACKUPS=0` (its commits leave none, and no
  longer prune the developer's backups); n > 0 is tested in `commit.test.ts` (a temp repo root).
  With `--url` it checks the commit's backup holds the file. `withGitUser` switches the git env.

### Phase 2 — Client: gather toasts and confirm writes — done

§2.4 items 1 and 2 (the client side) and the folder's rows (gather toasts, confirm writes,
author, backups).

**Exit:** a debug-only write shows the toast after its reload (and the asset errors when a
source fails); a failed gather shows the alert; an editor save shows none. With confirm writes
on, the dialog lists the files, Cancel writes nothing and rejects with `CANCELLED`, and a file
changed between the dry run and Confirm fails with `CONFLICT`.

As built:

- The settings: `AppConfig.devFiles.gatherToasts` (default true) and `confirmWrites` (default
  false), in `src/CONFIG.ts` too (so an app minor bump in Phase 9), `debugToolsState.devFiles`'s
  two keys (`_fillDevFilesDefaults` in `_dbg__DebugToolsState.ts` fills them into a `devFiles`
  object saved before them: LS replaces the whole object), read by `isDevFilesOptionOn(option)`
  (`debug/DevFiles.ts`, `@internal`: the tab's setting, else the config, else the default; false
  outside the debug env).
- `_writeDevFiles(writes, { skipConfirm? })` (`_dbg__DevFiles.ts`): the public `writeDevFiles`
  passes none; Phase 4's "Save specific data…" dialog calls it with `skipConfirm: true`. With
  confirm writes on: a dry run; when every file is `unchanged` no dialog (the commit writes
  nothing anyway); else `confirmDevFilesWrites(results)` (`_dbg__DevFilesConfirm.ts`: an
  `openDialog` per call, its own id, a `createBadge` per file's status, Cancel first and focused,
  Confirm `primary`; it resolves on its content's removal, so Escape and the close button are
  Cancel). The commit then sends every write's `previousHash` as its `expectedHash`.
  `DevFilesClientErrorCode` has `CANCELLED`.
- Gather toasts (`_dbg__DevFilesGather.ts`, run first in the `aek:gather` dispatch): a commit's
  changed paths are remembered 60 s; an event naming one takes it (a write toasts once). `failed`:
  an alert toast at once (until closed); `done` with `willReload`: the note in sessionStorage
  (`DEV_FILES_GATHER_NOTE_KEY`; two writes before one reload merge into one note); `done` without
  a reload: the toasts at once. After the reload `showDevFilesGatherNote()` (the thin module, so
  the implementation loads only when there's a note) runs in `Boot.ts`' debug step right after
  `flushQueuedDebugToasts()`: a `success` toast "Saved n files" with the paths (eight at most,
  then "and n more"), and with asset errors a `warning` toast listing them (until closed). The
  debug toaster got a `success` icon (`circleCheckCutout`): it had none.
- The File server folder: "Save entry author" (the status' `author`, else "None (git user.name
  not set)"), the two switches, and "Backups kept" ("The last 20 commits, in
  .cache/dev-files/backup/", "Every commit", "None (AEK_DEV_FILES_BACKUPS=0)"), read with the
  status row on every mount. Styles: `debug/DevFiles.module.scss` (the dialog and the toasts'
  lists).
- Checked in the browser (WebGL fallback, a scratch Playwright script): the dialog's list, Cancel →
  `CANCELLED` and nothing written, a file changed before Confirm → `CONFLICT` with the change kept,
  Confirm lands, the toast after a material write's reload, none after an editor save's, and the
  folder's rows. A failed gather's alert only in the unit tests (`_dbg__DevFilesGather.test.ts`):
  the server's validation keeps a dev files write from failing the gather.

### Phase 3 — The Æ menu and "Save scene" — done

§2.1 and §2.2: the menu item's disabled reason (the kit), the Æ menu on `createMenu` (About
moves into it), the save source registry, "Save scene" and its key. The first sources: sky boxes and PostFX passes (no
conversion).

**Exit:** a sky box layer and a PostFX param edited in `largeWorld` (`skyShowcase` lists no PostFX
pass), Ctrl+S: one commit with
both files, their entries merged over the latest ones, stamped; after the reload the scene
looks the same with localStorage cleared for them; a second Ctrl+S toasts "Nothing to save".
The Æ icon is a spinner and the menu disabled from the key press to the reload, and a second
Ctrl+S meanwhile only toasts. A file edited by hand in between fails with `CONFLICT`, keeps
localStorage, and brings the icon and menu back. The save items are
disabled with the reason when the dev files are off and when the save history size is 0. The
menu works by keyboard; Escape closes it.

As built:

- The kit (`ui/overlays/Menu.ts`, `MenuItems.ts`): `MenuActionItem.disabledReason`, a
  `createTooltip` on the item's right while it's disabled (its `aria-describedby`; Escape hides
  it before it closes the menu), removed with its level through the level's `hints` stops. Not
  in the plan: a trigger that's `disabled` or `aria-disabled="true"` opens nothing by a click or
  its arrows (a `focusableWhenDisabled` button's click got through to the menu's listener);
  `open()` from code still opens. Both in the kit's `CLAUDE.md`, the overlays guide and the
  library demo ("Revert" has a reason).
- The toolbar (`debug/_dbg__OnScreenToolbar.ts`): a tool with `menu: { label, items }` is a menu
  button (`createMenu`, removed with the group: the toolbar's new `remove()`, which `syncGroup`
  uses), plus `isLoading` and `getDisabledReason` read on every refresh (a disabled tool closes
  its menu). The Æ tool is key `aekasha`, label "Ækasha menu": "Save scene" (its hint the
  platform's chord only, ⌘S on a Mac, Ctrl+S elsewhere), a separator, "About Ækasha".
  "Save specific data…" is added in Phase 4, not disabled before it.
- `debug/SaveData.ts` (public on `aekasha/debug`: `registerSaveSource`, `SaveChange`,
  `SaveChangeWrite`, `SaveSource`): the registry, kept here so a source registered before the
  implementation loads counts. `build` may return null (the file has the change: nothing
  written, `onSaved` still runs); `extract` waits for Phase 8. `saveScene()` (`@internal`, the
  key's) loads `_dbg__SaveData.ts` on first use. `setSaveSourcesReady()` (`@internal`), called
  by `Boot.ts` after the features' `onDebugAfterStart` hooks: the sky box and PostFX tabs register
  their sources there, after the debug keys and the Æ button exist, so until then saving is off
  ("The debugger is still starting"; found in the browser: a Ctrl+S right after the first load
  saved the sky box and not the PostFX pass).
- `debug/_dbg__SaveData.ts`: the dev files' status cached for the menu's synchronous items
  (read when the tools are built and on every open); `_getSaveSceneDisabledReason` (saving, the
  debugger's boot, the status, a history size of 0, "Nothing to save in this scene");
  `_saveSceneAsync`: collect (a throwing source fails the save), the current scene's saveable
  changes and the global ones, a fresh `readDevFile` per path (its hash the `expectedHash`), one
  write per path (two `saveData` writes for one scene deep-merged, anything else refused), the
  gather listener added before the commit, `writeDevFiles` (so Confirm writes applies), every
  source's `onSaved` right after the commit, then the save stays on until the reload. It ends at
  a failed commit (an alert toast with the code; Cancel an info toast), every file unchanged
  ("Nothing to save"), a failed gather or one without a reload, and 30 s after the commit
  (started only once files were written: a Confirm writes dialog left open isn't cut short). An
  off reason toasts as a warning, not a sticky alert.
- The key (`DefaultDebugKeyBindings.ts`): `sc-save-scene`, Ctrl+S / ⌘S, `KEY_DOWN`, category
  `DEBUGGER`. §2.2 assumed the debug maps leave a text field's keys alone: they run the key's fn
  there and only skip the map's `preventDefault`, so the key needs no capture listener: its fn
  prevents the default always (repeats too; a repeat saves nothing), blurs a text field first,
  then `saveScene()`. Not covered: during a scene load the `DEBUG` maps are off, so Ctrl+S then
  opens the browser's dialog (left as is; a capture listener for the save chords would close it).
- The sources (`debug/_dbg__SaveEntries.ts`, what they share: the latest entry without `__meta`,
  `pruneSaveEntry`, `getChangedKeys`, `toSaveEntryWrite`, `findSceneAssetFile`): sky boxes
  (`features/skybox/debug/_dbg__SkyBoxSave.ts`, registered at the tab's first build; `deepMerge`,
  a whole list replacing) and PostFX passes (`features/postfx/debug/_dbg__PostFXSave.ts`,
  registered in `_createPostFXDebugGUI`; `enabled` replaced, `params` by key; the store moved to
  `_dbg__PostFXStore.ts`). Pruning is narrower than §2.1's wording: an entry value is dropped
  only when the file itself has the same value there (a sky box's preset merged in, a PostFX
  pass's `enabled` defaulting to true), never one equal to a renderer default the file doesn't
  set, and an object the file doesn't have stays even empty (dropping `clouds: { coverage: 0.5 }`
  from a file without clouds would turn the layer off). An empty entry is written only over an
  existing one. Not saveable: "scene not found", "not in the scene JSON" (made in code, or no
  longer listed), "inline in the scene JSON: it has no file of its own" (Phase 8 moves those).
- Checked in the browser (`largeWorld`, WebGL fallback, a scratch Playwright script on the dev
  server): Ctrl+S wrote both files in one commit and one gather ("Saved 2 files" after the
  reload), the entries stamped with the versions and the author; the Æ button busy 65 ms after
  the key and until the unload (~350 ms), a second Ctrl+S meanwhile "Saving…"; after the reload
  localStorage cleared and a second save "Nothing to save"; a stale hash (the read's header
  rewritten) → `CONFLICT`, localStorage and the file kept, the Æ button back; saving off and no
  dev files token give their reasons as the item's tooltip; the menu by keyboard, Escape back to
  the Æ button. The app files were restored after.
- For Phase 4: the server takes one `saveData` per write and a batch each path once, so "Save
  specific data…" with one sky box changed in two scenes needs two scenes' entries in one file in
  one commit. Proposed: a write's `saveData` may be an array (one entry per scene; the server and
  its self-check), keeping the batch all or nothing; a commit per scene would lose that. Also
  seen: the server's Prettier pass reformats a file's compact objects on every write
  (`ambientOcclusion.postFx.json`'s `paramsMeta` one-liners became multi-line): p342's, not
  changed here.
- Left for Phase 9: `yarn verify:baselines --update` (the API and docs baselines: the new
  exports), `yarn verify:ui --only menu` and the full `yarn verify:baselines` (the production
  build's debug code check).

### Phase 4 — "Save specific data…" — done

§2.3 and its key.

Sections:

1. **Entries of several scenes in one write:** a write's `saveData` may be a list, one entry per
   scene (Phase 3's As built): the protocol's types, the server's check and apply (each scene
   once; `unchanged` only when every entry is), its tests and self-check cases, the client's
   `DevFileWrite` and `_writeDevFiles`, and the save's `foldWrites` (two scenes' entries of one
   file a list, one scene's still deep-merged).
2. **The form's own error** (§2.3's decision): `createForm`'s `setError(message | null)`, a
   message in the error summary not tied to a field (no link), shown with the summary and its
   focus, cleared by the next submit and a reset; its test, its demo and the kit's docs. The
   dialog shows a failed save there.
3. **The save for given changes:** `_dbg__SaveData.ts`' pipeline shared by "Save scene" and the
   dialog (a filter of the changes, a result instead of toasts, `skipConfirm` for the dialog),
   the collected changes for the dialog's rows, and "Save specific data…"'s disabled reason (no
   saveable change in any scene).
4. **The dialog, the item and the key** (`debug/_dbg__SaveSpecificDialog.ts`): §2.3's groups,
   rows, buttons and busy state; "Save specific data…" in the Æ menu and `sc-save-specific`
   (Ctrl+Shift+S, ⌘⇧S) opening it (moved here from section 3: both open the dialog).
5. **The exit in the browser**, and this phase's As built.

**Exit:** with three changes, unchecking one saves the other two and leaves the third in
localStorage; Check all / Uncheck all and the group checkboxes; a sky box changed in
`skyShowcase` and saved from `largeWorld` under Other scenes lands in `skyShowcase`'s entry; a
PostFX pass shows under Not saveable when its scene is gone. With no change in the current
scene but one in another, "Save scene" is disabled and "Save specific data…" isn't.

As built:

- The server (section 1): a write's `saveData` is one entry or a list, each scene once (an empty
  list or a scene twice is `BAD_REQUEST`); the file is read once, the entries put in one after the
  other, each stamped and trimmed as alone; `unchanged` only when every entry is. The client's
  `DevFileWrite.saveData` takes the list (`_writeDevFiles` adds `historySize` to each). The save's
  `foldWrite`: one scene's changes of a file deep-merged into one entry, other scenes' joining the
  list; a file with one scene's entry still sends the entry alone. Tests: `commit.test.ts`, the
  self-check (both scenes gathered, a scene twice refused), `_dbg__SaveData.test.ts`.
- The form's own error (section 2, §2.3's decision: the kit, not the dialog's own line):
  `createForm`'s `setError(message | null, { focus? })` and `getError()`: the summary's first item
  (`li.aekForm__summaryMessage`, the danger colour, no link), the summary shown (and focused with
  `focus`); `validate()` keeps it first, the next submit (a new attempt) and a reset take it away,
  as do `null` and `''`, and a field fixed on a blur doesn't hide the summary while it's set. The
  library demo's "Submit it, the server down" (its error a microtask later: no timer for the
  screenshot) and a keyboard script; `verify:ui --only form` passed axe and the scripts, its new
  and moved screenshots not recorded yet (Phase 9).
- The save (section 3): `_saveChangesAsync(filter, { skipConfirm? })` is the one pipeline, the
  changes collected again at its start and the saveable ones the filter picks saved; it returns
  `SAVED` (the save stays on until the reload) / `NOTHING` / `OFF` (with the reason) / `FAILED`
  (with the error) instead of toasting, and `_saveSceneAsync` is it with the current scene's filter
  plus the toasts. `_getSaveErrorText` (the code, then the message) for both. `skipConfirm` goes
  through `writeConfirmedDevFiles` (`debug/DevFiles.ts`, `@internal`): the public `writeDevFiles`
  has no option, so no other tool skips "Confirm writes". `_collectSaveChanges`, `_isSaveableChange`
  and `_getSaveSpecificDisabledReason` (as "Save scene"'s, but off only with nothing saveable in
  any scene: "Nothing to save") for the dialog and the menu.
- The dialog (section 4, `debug/_dbg__SaveSpecificDialog.ts`, `debug/SaveData.module.scss`; loaded
  on first use by `_openSaveSpecificAsync`, which checks the status and the reason first and toasts
  it instead): a `createForm` of fieldsets (`legendHidden`, the legend the group's name), each led
  by a heading `createCheckbox` labelled with the group's title and count (`setIndeterminate` while
  some of its rows are checked); "Other scenes" holds a fieldset per scene (its name, else its id)
  set in under it. A row's hint is its file and changed keys (five, then "and n more"). Not
  saveable: a list with each change's scene and reason. The rows' kit reset buttons are hidden
  (`.aekField__reset`: one per toggled row crowded the list; Check all / Uncheck all cover it).
  The footer is outside the scrolling form: Check all, Uncheck all, then Cancel and Save (n), the
  submit through the `form` attribute (so it stays in view); the dialog drives its loading. A save
  turns every box and button off; `SAVED` closes it (the reload follows), `NOTHING` closes it with
  a toast, `OFF` and `FAILED` keep it open with "Not saved: …" as the form's own error (the
  summary at the top takes the focus: not "under the buttons" as §2.3 had it). Moved here from
  section 3: the item "Save specific data…" (its key hint, its reason as the tooltip) and the key
  `sc-save-specific` (Ctrl+Shift+S, ⌘⇧S; as `sc-save-scene`: always prevented, a typed field
  blurred first) through `SaveData.ts`' `saveSpecific()` (`@internal`).
- Checked in the browser (`largeWorld`, WebGL fallback, a scratch Playwright script on a dev server
  of its own, port 8095): only `skyShowcase`'s change: "Save scene" off with "Nothing to save in
  this scene" (its tooltip shown, so the menu's first Escape hides it: the kit's rule), "Save
  specific data…" on; Ctrl+Shift+S opens it with Other scenes unchecked (Save (0)) and a PostFX
  pass of a scene that's gone under Not saveable. With `largeWorld`'s sky box and PostFX changes
  too: Save (2), Check all (3), Uncheck all (0, off), the This scene box, a row unchecked (the box
  mixed), the Other scenes box; Save wrote `dayNight.skybox.json` once with both scenes' entries,
  stamped, left the unchecked PostFX pass unwritten and in localStorage, the sky box's overrides
  gone, "Saved 1 file" after the reload. The app files were restored after. Not checked: Firefox,
  whose screenshot tool is Ctrl+Shift+S (whether the page's `preventDefault` stops it), and a real
  GPU.
- Seen while checking: on the WebGL fallback `largeWorld`'s frames starve the compositor, so a CSS
  transition never starts (`currentTime` 0 for seconds) and a checkbox changed by code paints its
  old state while `:checked` matches; with the test bridge's `freeze()` first every box paints
  right. The environment's, not the dialog's; a scratch script on a heavy scene freezes the loops
  before it reads anything painted.

### Phase 5 — Cameras and lights — done

Their sources: the UI keys and `debugCam` stripped, light colours to `#rrggbb`, values equal to
the asset's dropped, the UI keys kept after a save.

The gather merges a camera's and a light's entry flat over `camProps` / `lightProps` (a key
replaces the whole value), so their entries are pruned flat: a top-level key kept whole or dropped
whole, never a partial `position`. A record holds the edited keys as full values (not a delta), so
the change is what differs from the props the scene has (the dev data's resolved list, the latest
entry in it); a record with no such key is no change and isn't listed.

Sections:

1. **The shared parts and i165:** `findSceneAssetFile` for `cameras` and `lights` (a resolved
   entry's id its props' `appId`, else `entityOpts.appId`), `getSceneListItem` (the scene's
   resolved entry, to diff against) and `pruneFlatSaveEntry` in `debug/_dbg__SaveEntries.ts`;
   i165 fixed (a light's new record has no `enabled`: otherwise a helper toggle on a light created
   disabled reads as switching it on, and the save would write it). Tests.
2. **The camera source** (`kernel/camera/debug/_dbg__CameraSave.ts`): `helperVisible`,
   `_lensSettingsOpen` and `debugCam` left out, the values diffed against the scene's camera, the
   entry the latest one with them over it, pruned flat against the file's `camProps`; `onSaved`
   drops the value keys and keeps the UI keys. Registered in `registerCameraDebugGUI`. Tests.
3. **The light source** (`kernel/light/debug/_dbg__LightSave.ts`): the same with `helperVisible`,
   `symbolVisible` and the folders' open states, colours (hex numbers) as `#rrggbb` and compared
   with the file's as colours (`"orange"`, `{ r, g, b }`), `enabled` against its default true; a
   managed light never has a record. Registered in `registerLightDebugGUI`. Tests.
4. **The exit in the browser**, and this phase's As built.

**Exit:** a light's colour and a camera's fov saved from largeWorld land as entries with only
those keys; helper toggles alone are no change; a light made in code is Not saveable.

As built:

- The shared parts (section 1, `debug/_dbg__SaveEntries.ts`): `findSceneAssetFile`'s kinds take
  `cameras` and `lights`; `getSceneListItem(list, sceneId, assetId)` is the scene's resolved entry
  (`findSceneAssetFile` checks the listing with it); `pruneFlatSaveEntry(entry, base)` drops a
  top-level key the base has with the same value (JSON compared, so key order counts: a file's
  `{ y, x, z }` reads as a change and is written again, harmless). An inline camera or light whose
  app id is also a file's id would be taken for that file, as for sky boxes: the gather claims no
  inline ids (Phase 8's).
- i165 fixed and closed (`docs/issues/_DONE_i165_…`): a light's new record has `helperVisible` and
  `symbolVisible` only (not `enabled`: those two stay, the visibility reader takes a missing
  `helperVisible` as false while a record exists), and `LightEntityDebugState.enabled` is optional.
  A record from before keeps its `enabled: true`, which the light source reads as no change for a
  light that's on.
- The sources (sections 2 and 3, `kernel/camera/debug/_dbg__CameraSave.ts`,
  `kernel/light/debug/_dbg__LightSave.ts`): a record's values are its keys but
  `CAM_DEBUGGER_ONLY_KEYS` / `LIGHT_DEBUGGER_ONLY_KEYS` (exported from the `_dbg__*DebugState.ts`
  modules, which the "Local storage override" row reads too); the change's summary is the keys that
  differ from the scene's entry (`pruneFlatSaveEntry` against it), none and the record isn't
  listed; `build` puts every value over the file's latest entry and prunes flat against the file's
  `camProps` / `lightProps`. The lights compare through `toComparable` (colours as `#rrggbb` through
  `toThreeColor` and `THREE.Color`, `enabled` defaulting to true; only the entry's own keys count)
  and write the record's colours as `#rrggbb`, a latest entry's colour as it was written. `onSaved`
  deletes the collected value keys, a record left empty and a scene left empty
  (`pruneEmptyCamScene` / `pruneEmptyLightScene`); the preferences and `debugCam` stay. Labels
  `Camera "<appId>"` / `Light "<appId>"`; ids `camera` / `light`. Registered in
  `registerCameraDebugGUI` / `registerLightDebugGUI` (`Camera.ts`, `Light.ts`; re-exported through
  the GUI modules), which the boot runs before the features: before `setSaveSourcesReady`. A
  colour string three can't parse is compared as white (three warns on every collect); such a
  light renders white with the same warning.
- Checked in the browser (`largeWorld`, WebGL fallback, a scratch Playwright script on a dev server
  of its own, port 8095, run twice from a clean state): the edits through the debugger's own
  writes, called in the page (`saveLightToLS` for the sun's colour, `saveCameraToLS` for the
  overview's fov and its lens folder, `_toggleAllLightHelpers(true)` over every light, the
  lanterns too, a symbol and a camera helper, a lantern's intensity): 12 light records, none with
  `enabled`; the collect and the "Save specific data…" dialog list only the camera's `fov` and the
  sun's `color` under This scene and `largeWorldLantern0` under Not saveable ("not in the scene
  JSON"). Ctrl+S: one reload, `largeWorldOverview.camera.json` got `{ fov: 50 }` and
  `largeWorldSun.light.json` `{ color: '#ff0000' }` for `largeWorld`, stamped (versions, author);
  after it the sun is red and the fov 50, the records hold only their preferences (the lantern its
  intensity too), and "Save scene" reads "Nothing to save in this scene". No console errors. The
  app files were restored after. Not checked: the edit windows' fields themselves (their writes are
  the unit tests'), and a real GPU.

### Phase 6 — Material editor (the current scene's materials) — done

Its source (§2.1): the edited materials the current scene lists, as that scene's `__saveData`
entries; the others Not saveable with the warning toast. A save clears the saved records'
`overrides` (settings and camera kept).

Found while starting it (2026-11-25): the editor's copy was the raw JSON (the registry's, its
`__saveData` dropped), so after a save the editor showed the file's old value while the scene
showed the entry's, and an entry's value could never be set back to the file's (an override equal
to the raw value is dropped). Decided: the editor's base becomes the current scene's material.
`testTslMat` is a `setup` material: its edits are `inputs`, not `nodes`.

Sections:

1. **The editor's base:** a material the current scene lists is shown as the scene has it (the
   dev data's resolved entry, its latest save entry in it), else as its file; the copy's props
   and the dropping of an override equal to the base both read it. The selector's entries (path,
   name, description) stay the registry's. Records stay global: an override equal to the current
   scene's value is dropped while that scene is current. Tests.
2. **The material source** (`debug/editors/material/_dbg__MaterialSave.ts`): one change per
   record with `overrides`, for the current scene: its file when the scene lists the material,
   else Not saveable ("not in this scene"; "material not found" when the registry hasn't it).
   `findSceneAssetFile` takes `materials`. The entry is the latest one with the overrides over it
   (`params` and `inputs` by key, `nodes` by socket then input), pruned value by value against the
   file (a value compared whole: the gather replaces a vector whole, so `pruneSaveEntry`'s deep
   walk would cut one). `onSaved` removes the records' `overrides` and loads the shown copy again.
   Registered in `_registerMaterialEditorView` (the boot's, before `setSaveSourcesReady`). Tests.
3. **"Save scene"'s warning:** the current scene's Not saveable material changes named in a
   warning toast ('Not saved: "rock", "bark" aren't in this scene's materials (they keep their
   editor changes)'), after the reload through the gather note when one follows, at once
   otherwise. Tests.
4. **The exit in the browser**, and this phase's As built.

**Exit:** in `sceneTestECS`, `testTslMat` (its only material, a TSL one: its `nodes`) edited in
the material editor and saved with Ctrl+S (also from the material editor view): its JSON gets a
`sceneTestECS` entry with the edits merged into the existing one, the scene shows them, and the
editor shows no override. `asteroid` (listed by `space` and the Hub hero example, not by
`sceneTestECS`) edited too: the same Ctrl+S leaves it out with the warning toast and
keeps its editor changes; it's Not saveable in the dialog.

As built:

- The editor's base (section 1): `getMaterialBase(id)` (`_dbg__MaterialEditorAssets.ts`) is the current
  scene's resolved entry when the scene lists the material with the same type (`getSceneListItem`,
  whose kinds take `materials`), with the file's `__sourcePath` kept (the Params tab's Source row),
  else the registry's file. The copy's load, the Params tab and the TSL inputs' base for an edit
  and for an undo written into the record read it; the params' base is the copy's, so it follows.
  The name, the title, the existence checks and the selector stay the registry's. Test:
  `_dbg__MaterialEditorAssets.test.ts`.
- The source (section 2, `debug/editors/material/_dbg__MaterialSave.ts`, id `material`): every
  record with `overrides` is a change of the current scene (a record with only settings or a pose
  isn't listed), its summary the overrides (`params.<key>`, `inputs.<key>`,
  `nodes.<socket>.<input>`); Not saveable "material not found" (not in the registry) or "not in
  this scene". `mergeMaterialEntry` (the latest entry, `params` and `inputs` by key, `nodes` by
  socket then input, values replaced whole) and `pruneMaterialEntry` (each value compared whole
  with the file's, JSON compared: a file's `"#FFAA00"` against the editor's `"#ffaa00"` is written
  again, harmless; other keys flat; an emptied group or socket dropped). `onSaved` removes the
  collected overrides one by one (as the lights' keys); the copy isn't made again (it shows the
  saved values, and made now it would show the dev data from before the save until the reload),
  the Params tab's reset button follows its LS key. Registered in `_registerMaterialEditorView`.
- "Save scene"'s warning (section 3): `getUnsavedMaterialsWarning(changes, sceneId)` (the material
  source's, by its `changeKeys`) gives the text; `_saveSceneAsync` reads it before the save and
  passes it as `_saveChangesAsync`'s `warning`, which a save that wrote files keeps: the gather
  with the reload adds it to the gather note (`GatherNote.warnings`, shown after the reload with
  "Saved n files", also with the gather toasts off), a gather without a reload or a failed one
  and the 30 s timeout show it at once. With nothing to write it's the only toast ("Nothing to
  save" would say less); failed, cancelled and off saves don't show it. `_dbg__SaveData.ts`
  imports the material source's function (not a new public `SaveSource` field). The dialog
  doesn't use it: it lists those materials under Not saveable.
- Checked in the browser (`sceneTestECS`, WebGL fallback, a scratch Playwright script on a dev
  server of its own, port 8095): `testTslMat` seeded with a `sceneTestECS` entry
  (`{ glow: 0.9, baseColor: '#203040' }`); the editor showed glow 0.9 and that baseColor (the
  scene's); the edits through the editor's bindings (`editCopyNodeInput`: panelColor `#00ff00`,
  gridScale 2, glow back to the file's 0.6) and asteroid's `colorNode.noiseScale` 2.5; the dialog
  listed `testTslMat` under This scene and asteroid under Not saveable ("not in this scene").
  Ctrl+S in the material editor view: one reload, the new entry `{ inputs: { baseColor:
  '#203040', panelColor: '#00ff00', gridScale: 2 } }` (glow dropped: the file's) stamped, the
  seeded one kept second, asteroid's file untouched; after the reload "Saved 1 file" and the
  warning naming asteroid, the scene's and the editor's uniforms the saved values,
  `testTslMat`'s record only its camera pose, asteroid's override kept; a second Ctrl+S only the
  warning, nothing written. No console errors. The app files were restored after. Not checked: a
  real GPU, the Params tab's fields themselves (their writes are the bindings the script called).

### Phase 7 — Scene JSON entries — done

§2.5: the scene's `__sourcePath` in the dev data, the `spatialDomains` merge by id, and the
`postFxEnabled` and spatial cell size sources.

Sections:

1. **The gather:** the scene's `__sourcePath` in the dev data and the `spatialDomains` merge by
   id. Tests.
2. **The save pipeline:** one scene's changes of one file built one over the other (found in
   section 1: two sources now write one scene's entry), and the scene file's helpers. Tests.
3. **The `postFxEnabled` source.** Tests.
4. **The spatial cell size source.** Tests.
5. **The exit in the browser**, and this phase's As built.

**Exit:** a scene's PostFX switched off and a cell size changed, saved (`largeWorld`, whose JSON
has `spatialDomains`): the scene JSON gets one entry with both, the gather applies it
(`generatedAppData.json`), and a scene without `__saveData` gathers as before (the production
data byte for byte; the dev data with only its `__sourcePath` added).

As built:

- The gather (section 1): `applySceneSaveEntry(scene, sceneId)` (`devTools/gather/saveEntries.ts`),
  which both scene readers use (`resolveScene`, `registries.ts`' `readScenes`): the entry's fields
  replace the scene's, but `spatialDomains` merges by id (an entry's domain field by field over the
  scene's with its id, one the scene doesn't list appended). `resolveScene` sets the scene's
  `__sourcePath` (the file's, repo-relative), which production already deleted. The repo's data
  gathered before and after: production byte for byte the same, the dev data 41 scenes (and the
  two profiles' scenes) with only their `__sourcePath` added. The committed `src/generated/` gets
  those lines at its next gather (section 1's commit had none). `devTools/gather/CLAUDE.md` has the
  merge and the scene's `__sourcePath` already (Phase 9 needn't add them). Tests in
  `gather.test.ts`' G5 block.
- Not in §2.5: a save entry's `spatialDomains` is validated by the scene's own list schema
  (`SceneOverridesSchema`), so an item of another domain than `DEFAULT` needs `cellSize` and
  `maxMembers`: a bare `{ id, cellSize }` is valid only for `DEFAULT`. The source writes what
  differs from the file's item plus, but for `DEFAULT`, the two required fields.
- The save pipeline (section 2, `_dbg__SaveData.ts`): Phase 4's `foldWrite` deep-merged two
  changes' entries of one scene, which can't drop a key: with the latest entry's `postFxEnabled:
  false` switched back to the file's true, the PostFX build dropped it and the cell size build's
  copy of the latest entry put it back. Now one file's changes are built one after the other, each
  seeing the entries built before it as its scene's latest (`withBuiltEntries`), and a scene's
  entry is replaced in its place; an entry a later build left empty for a scene the file has none
  for isn't written (`dropEmptyNewEntries`). `SaveChange.build`'s JSDoc says so. No earlier source
  has two changes of one file and scene, so nothing they write changed. `_dbg__SaveEntries.ts`:
  `getDevScene(sceneId)` (the dev data's scene) and `findSceneFile(sceneId)` (its `__sourcePath`,
  else "scene not found" or "the scene JSON has no file path").
- The `postFxEnabled` source (section 3, `features/postfx/debug/_dbg__PostFXSave.ts`'
  `registerPostFxEnabledSaveSource`, id `postFxEnabled`, label "PostFX switches"; registered next
  to the passes' source in `_createPostFXDebugGUI`): a change per scene in
  `AEK_debugPostFxSettings`' `postFxEnabled` ("PostFX switched on / off", summary
  `postFxEnabled`); the entry is the latest one with `postFxEnabled` only when it differs from the
  file's (true by default); `onSaved` drops the saved scenes' keys, `measureEnabled` kept. The
  settings store moved to `_dbg__PostFXStore.ts` (`SETTINGS_LS_KEY`, `readSettingsLS`,
  `writeSettingsLSOrRemove`), as the passes' had.
- The cell size source (section 4, `features/spatial/debug/_dbg__SpatialGridSave.ts`, id
  `spatialDomains`, label "Spatial domains"; registered in `_createSpatialGridDebugGUI`, the
  feature's `onDebug` hook, before `setSaveSourcesReady`): a change per domain and scene in
  `cellSizeByScene` (`Spatial domain "<id>" cell size`, summary `spatialDomains.<id>.cellSize`),
  none when the scene (the dev data's list) has that cell size already; Not saveable "scene not
  found" and "not in the scene JSON's spatialDomains (registered in code)". The world scope's cell
  size isn't saved (§1). The entry's item is the file's item with the latest entry's over it and the
  cell size, pruned as above (an item equal to the file's dropped, an emptied list too), in its
  place in the latest entry's list. `onSaved` clears the saved scopes (`clearSavedCellSize`) and
  persists the tab's `domains` once; the live grid isn't re-applied (the reload follows). Not
  handled: a scene whose code registers a domain with its scene id over the JSON's (the code's
  registration wins at load, so a saved cell size applies only when the code passes none); no app
  scene does.
- Checked in the browser (`largeWorld`, WebGL fallback, a scratch Playwright script on a dev server
  of its own, port 8095): PostFX switched off with the PostFX tab's switch and `DEFAULT`'s cell size
  set to 30 in the Spatial index tab's field (by keyboard, through the test bridge's
  `openDebuggerTab` / `focusDebuggerControl`), both listed under `largeWorld` with the scene JSON's
  path. Ctrl+S with the field still focused: one reload, `largeWorld.scene.json` got the entry
  `{ spatialDomains: [{ id: 'DEFAULT', cellSize: 30 }], postFxEnabled: false }` stamped (versions,
  author), the generated data the same values; after the reload PostFX off and the domain at 30,
  `AEK_debugPostFxSettings` gone and the tab's `cellSizeByScene` cleared (its colours kept),
  "Saved 1 file", "Save scene" reads "Nothing to save in this scene". No console errors. The app
  file was restored after. Not checked: a real GPU, a domain other than `DEFAULT` (no app scene
  lists one; the unit tests').

### Phase 8 — Inline assets to JSON files — done

Needs Phase 7 (the scene JSON's `__sourcePath` in the dev data). §2.6: the server's `json` +
`saveData` write (with self-check cases: the stamped entry in a
created file, `expectedHash: null` refusing an existing one), the extraction in the camera,
light and sky box sources, the dialog's "moves to" line.

From Phase 7: the scene JSON now also takes `saveData` writes (the `postFxEnabled` and cell size
sources), and `foldWrite` refuses a `json` write and a `saveData` write of one file ("two changes
need writes that can't be merged into one"). The move's scene JSON write is a `json` one, so a
scene with an inline asset and a PostFX switch or cell size change saved together needs them
folded into one write of both (the server's `json` + `saveData` write, above: the entries applied
over the new JSON). `findSceneFile` (`_dbg__SaveEntries.ts`) gives the scene JSON's path, and the
builds of one file run one after the other (each seeing the entries built before it).

**Exit:** `topDownTest`'s inline sky box (`topDownTestSky`; the app's other inline assets are the
cameras and lights of `streamingGrid`, `streamingPhysics`, `batchedMeshSpike` and
`instanceStress`) edited and saved: one commit creates `src/app/scenes/topDownTestScene/topDownTestSky.skybox.json` with the
entry for `topDownTestScene`, and the scene JSON lists `"topDownTestSky"` at the same place;
after the reload the sky looks the same and the debug overrides are gone. A file put at that
path first makes it Not saveable ("taken"), and nothing is written.

Sections:

1. **The server's `json` + `saveData` write:** the protocol, the server, the client, their tests
   and the self-check's cases.
2. **Telling an inline asset from a listed one:** the gather's `__inlineAssets` in the dev data,
   `findSceneAssetFile`'s move (or why it can't), `SaveChange.extract`, the sources. Tests.
3. **The move in the save pipeline:** the new file, the id in the item's place, the scene JSON's
   one write with its own entries. Tests.
4. **The dialog's "moves to" line, the exit in the browser**, and this phase's As built.

As built:

- The server (section 1): a write may carry `json` and `saveData` together (`parseRequest`: json,
  saveData or both, or a stageId); `applySaveDataToJson` (`devFiles/saveData.ts`, beside
  `applySaveDataWrite`, the two sharing `applyEntries`) puts the entries into that value as into a
  read file (stamped, the history size kept, after the value's own entries); the file needn't
  exist, and whether it changes is the written bytes'. `saveData` alone still needs the file.
  `DevFilesWrite`'s and the public `DevFileWrite`'s `json` variant take an optional `saveData`
  (an API baseline change, Phase 9). Tests in `commit.test.ts`; the self-check's case refusing the
  pair became the move's (created, stamped, `CONFLICT` again with `expectedHash: null`, a
  `stageId` with them `BAD_REQUEST`); `yarn verify:devFiles` passed (79).
- Not in §2.6 (section 2): the dev data couldn't tell an inline entry from a listed one (both
  resolve to objects), so an inline asset whose id a file has would have been saved into that
  file, where the gather never applies it. The gather now writes the development data's scene
  `__inlineAssets: { cameras?, lights?, skyboxes? }` (`scenePass.ts`' `getInlineAssetIds`: an
  inline camera's or light's props' app id, else its entity's, a sky box's `id`; none without an
  id, none for a list the scene's save entry replaces; typed on `ResolvedScene`, not the scene
  schema). The repo's dev data got it in the five scenes with inline assets, nothing else;
  production has none. Also unlike §2.6: the gather applies an inline sky box's own `__saveData`
  (`resolveSkyBoxes`); the moved file keeps those entries after the new one.
- `findSceneAssetFile` (section 2): a marked inline camera, light or sky box moves to
  `<scene JSON's folder>/<id>.<camera | light | skybox>.json`; Not saveable "id taken by
  `<path>`" (the registry has the id), "new file taken: `<path>` is "`<id>`"'s" (a gathered file
  is at the new path), or the scene's "the scene JSON has no file path". Any other inline asset
  (a material, a PostFX pass, or one in a save entry's list) keeps "inline in the scene JSON: it
  has no file of its own". `toChangeFileFields` gives every source but the spatial domains' its
  `path`, `unsaveable` and `extract`.
- `SaveChange.extract` (section 2) is `{ scenePath, list, id }`, not §2.1's `{ newPath,
  scenePath }`: the change's `path` is the new file. `SaveChangeExtract` is public on
  `aekasha/debug` (Phase 9: the API baseline).
- The pipeline (section 3, `_dbg__SaveData.ts`' `buildFileWrites`): a move is grouped with its
  scene JSON, read fresh once with that scene's own changes. The item is found by
  `getListItemId` (exported from `_dbg__SaveEntries.ts`) and replaced by its id in place; the
  change's `build` gets the item as the file's JSON. The new file is `{ $schema, ...item }`
  (`getInlineFileSchemaRef`: relative to its folder) with the entry and `expectedHash: null` (a
  file put there since the page loaded is a `CONFLICT`; no read first, whose 404 the browser logs
  as a console error: seen in the exit); the scene JSON one `json` write with the ids in place and
  its own entries as `saveData`; the new files go first in the batch. A move whose build is null
  stays inline. Refused before anything is written: the item no longer inline ("reload the
  page"), one id moved by two scenes in one save (both files would claim it), a move's build that
  isn't an entry, and a scene JSON with a move and a whole-JSON change.
- The dialog (section 4): an inline asset's row reads "`<scene JSON>` (moves to `<new file>`):
  `<keys>`".
- Checked in the browser (`topDownTestScene`, WebGL fallback, a scratch Playwright script on a
  dev server of its own, port 8095): `env.environmentIntensity` 0.7 set through the sky box tab's
  `setSkyBoxParam`; the collect and the dialog listed it under This scene with the scene JSON and
  "moves to `src/app/scenes/topDownTestScene/topDownTestSky.skybox.json`". Ctrl+S: one commit,
  the new file (its `$schema`, the item as it was, the `topDownTestScene` entry stamped with the
  versions and the author), the scene JSON's `skyboxes` `["topDownTestSky"]`; after the reload
  "Saved 2 files", the sky the same with intensity 0.7, `AEK_debugSkyBox` gone, "Save scene"
  "Nothing to save in this scene", no console errors (after the 404 fix above). Taken: a sky box with another id put at that path first, the
  change Not saveable ("new file taken"), Ctrl+S "Nothing to save", nothing written. The app
  files were restored after. Not checked: a moved camera or light in the browser (the unit
  tests'), a real GPU.

### Phase 9 — Docs and versioning

`src/_engine/debug/CLAUDE.md` (the Æ menu, save sources and how a debug module adds one, an
inline asset's move and `SaveChange.extract`, the keys), `devTools/devFiles/CLAUDE.md` (the File
server settings, the env var, the author, the dry run, the `json` + `saveData` write: its API line
still lists the three write kinds), `devTools/gather/CLAUDE.md` (the scene's `__sourcePath` and
the `spatialDomains` merge: written in Phase 7, check it; the development data's
`__inlineAssets`, Phase 8), the kit's `CLAUDE.md` (the menu
item's reason, a form-level error if added), the Hub's Debug suite page
(`hub/pages/features/debug-suite/`), `readme.md` if it lists the debug keys, the versions and
`CHANGELOG.md` (§4).

## 4. Versioning

Engine minor (the save menu, `debug/SaveData.ts`, the menu item's disabled reason,
`MetaSchema.author`, new `AppConfig.devFiles` keys). App minor if `src/CONFIG.ts` gets the new `devFiles` keys.
Project entry for the dev server's author, backups and dry run. No toolkit change.

## 5. Open questions

None. Decided: inline assets move into their own files (§2.6); a save history size of 0 turns off
every save, a later global one too (§2.2); characters aren't saved in this plan (§2.1).
