Status: in progress | Phase 1 implemented
Category: Documentation, Hub, Tooling
Epic: p800_debugger-ui-overhaul.md
Blocks: p801_design-foundation.md (only its Phase 0: the font specimen page needs Phase 1's dev-only pages), p809_project-roadmaps-and-docs-split.md
Blocked by: p801_design-foundation.md (only Phase 3, the design document, reads p801's `tokens.css`)
Related: \_DONE_p601_refactoring-safety-net-tests-and-baselines.md (`::: dev-only`), \_DONE_p619_review-schemas-pipeline-devtools-hub.md (the Hub's generator as it is)

# Hub Project Section

p800's second child: pages the dev server's Hub shows and the public Hub never builds, a
**Project** button that opens them, and the first of them: the project's philosophy, how Ækasha
is developed (conventions, the plan and issue workflow, the code block reference), the app's own
page with a design document template, Ækasha's design document, and the component library for
developing Ækasha. Phase 1 lands on its own first, so p801's font study has a dev-only page to
live on (p801 D11).

---

## 1. As found (2026-10-23, `main` at `192292a`)

### 1.1 p800's p802 sketch, checked

- **No sitemap.** The Hub writes none (no `sitemap` anywhere in `devTools/hub/` or `hub/`): a
  dev page has to stay out of the output, the nav, the search and the link targets only.
- **`devTools/refactor/moveText.test.ts` is gone**, with `devTools/refactor/` (commit `b1083be`,
  p619 Phase 7). Moving `code-blocks/` touches `physicsTest.ts`' region note,
  `hub/pages/documentation/code-blocks/intro.md` (its own copy of the note, line 153),
  `hub/CLAUDE.md`, `devTools/hub/CLAUDE.md` (the API section's "not `documentation/code-blocks/`"),
  `docs/techniques/hub-authoring.md` (line 300) and `hub/_assets/ts/_search.ts` (a JSDoc
  example only).
- **No page links `code-blocks/`** (`git grep` finds no `hub:documentation/code-blocks`): making it
  dev-only breaks no public link. The Documentation page reaches it through the nav only.
- The Hub's scripts (`hub/_assets/ts/`, Vite's `build()` in `devTools/hub/assets.ts`) have no
  `aekasha*` aliases, no `__AEK_DEBUG__` define and no CSS module handling set up: the component
  library page (Phase 4) adds them.

### 1.2 How the Hub decides what a page is (`devTools/hub/`)

- `pages.ts`: `discoverPages` takes every folder under `hub/pages/` with an `index.html`
  (`listDirs` skips `_`- and `.`-prefixed folders); `parsePage` reads the `aek:` metas
  (`META_NAMES`; an unknown one warns) into a `HubPage` with `isInMenu: true`, `isSearchable: true`.
  A page without its parent page is an error.
- `build.ts`: the coverage check (`checkClaudeMdCoverage`) runs on `tree.pages` right after
  discovery; the search is built from the rendered pages (`buildSearchIndex`); `checkLinks`
  (`renderPages.ts`) makes a `hub:` link to a path not in `tree.byPath` an error ("Dead link …: no
  page at …").
- `markdown.ts`: `::: dev-only` content is skipped before parsing in `public`, so its links are
  never collected there; in `dev` it is parsed like any other, and nothing records that a link
  was inside one.
- `shell.ts`' `renderNav`: the homepage and its children, each top-level child with a dropdown of
  its `isInMenu` children. `hub/_layout/shell.html`: `.hubNavPanel` holds `.hubNav` and
  `.hubTools` (search, version pill, GitHub, theme toggle); on a narrow screen the panel is the
  menu button's.
- The homepage hero's right column: `.hubHeroSide` with the "Build / Explore / Create" eyebrow
  and the `generated-hero-side` slot (`generated/home.ts`: the engine's description).

---

## 2. Decisions (confirmed 2026-10-23, as recommended)

### D1. A dev page: `aek:dev`

- `<meta name="aek:dev" content="true" />` (in `META_NAMES`) marks a page and every page under it
  as dev only (`HubPage.isDev`, inherited in `discoverPages` once the tree is linked). A child
  can't opt back out: a public page under a dev one would lose its parent in `public`.
- `public`: dev pages are dropped from the tree after the coverage check (D4) and before
  rendering, so they're absent from `dist-hub/`, the nav, the search, `::: cards` lists and the
  link targets. `dev`: they're ordinary pages, in the nav and the search, with a "Local only"
  badge in their breadcrumbs (the `::: dev-only` block's `.hubDevOnlyBadge`) so nobody takes one
  for public documentation.
- A generated section's page can't be dev (none needs it); `attachSection` errors if its parent is.

### D2. Links to a dev page

- A `hub:` link from a public page to a dev page is an error **in both modes**, outside a
  `::: dev-only` block: "`hub:project/…` is a dev-only page: a public page can link it only inside
  `::: dev-only`". In `dev` the author sees it on save instead of at `hub:build`.
- Each link records whether it is inside a `::: dev-only` block (`HubLinkRef.isInDevOnly`):
  links are resolved in a core rule (`linksRule`), not while rendering, so the directive's tokens
  carry `meta.isDevOnly` and the rule counts the open blocks. A generator that writes a link for
  the dev server only passes `isInDevOnly` to `resolveHubLink`. `checkLinks` reads it with the
  source page's `isDev`, and in `public` tells a link to a removed dev page
  (`HubPageTree.removedDevPaths`) from a dead one. A page's markup (its `index.html` body)
  has no `::: dev-only`, so a markup link from a public page to a dev page is always the error.
- Links from a dev page anywhere are checked as today.

### D3. The Project button

- `project/` is a top-level dev page. `renderNav` leaves top-level dev pages out of the nav list;
  the shell gets a `{{projectLink}}` placeholder before `.hubTools`, filled in `dev` with
  `<a class="hubProjectButton" href="…project/">{{icon}}<span>Project</span></a>` and with `''` in
  `public` (so the public header is unchanged byte for byte).
- Filled with the accent (`--hub-accent` background, `--hub-bg` text: the one filled control in
  the header, p800 D6), the `compass` icon (Phase 1 adds it to `hub/_assets/icons/` if the set
  has none), `aria-current="page"` on a Project page. In the mobile panel it's the first item
  under the nav, full width.
- Its pages get the section style `project` (`getPageSection`), so `_sections.scss` can mark them.

### D4. Coverage counts dev pages

The CLAUDE.md coverage check is about the repo's documentation, not the output: it runs on every
discovered page, dev ones included, in both modes. A section only a dev page covers (the plan
workflow, the Hub's own sections) doesn't warn in `public`. `::: claude-md` already renders
nothing in `public`.

### D5. The pages

```
project/                      Philosophy: the brand and core principles (root CLAUDE.md's), how
                              the project is developed (plans, phases, review stops, versions),
                              and what this section is
project/aekasha/              Developing Ækasha: code conventions (links the public coding
                              standards, then the rules that are only for the repo: the hooks,
                              the ratchets, the baselines), the plan and issue workflow
                              (docs/plans/CLAUDE.md's rules in reader form), and the children:
project/aekasha/code-blocks/  moved from documentation/code-blocks/ (D7)
project/aekasha/design/       the design document (Phase 3, D8)
project/aekasha/components/   the component library for developing Ækasha (Phase 4, D9)
project/app/                  The app's own: its conventions (what goes in src/app/, the scene
                              folder rule, its version), and the children:
project/app/design/           a design document template to copy and fill (D8's headings, empty)
project/font-study/           p801 Phase 0's specimen; after p801 it moves into design/ as the
                              fonts' record, or is removed (p801 decides)
```

The content comes from the root `CLAUDE.md`, `docs/plans/CLAUDE.md` and the coding standards
page, rewritten for a reader (not copied: those files stay the agents' source, and each page's
`aek:covers` names the sections it explains, so the coverage check keeps them in step).

### D6. The hero's dev links

In `dev`, `.hubHeroSide` gets a second block under the description: "Project" quick links, the
app's design document first (`project/app/design/`), then Ækasha's design document, the
component library and the plan workflow. A new generated slot (`generated-hero-project`, empty in
`public`), so the homepage's markup has no `::: dev-only` problem (D2).

### D7. Moving `code-blocks/`

`git mv hub/pages/documentation/code-blocks hub/pages/project/aekasha/code-blocks`, then the
references in §1.1 in the same commit, with `yarn hub:build` (the region include is checked) and
both modes looked at. Its `aek:order` and tags stay. The public Hub loses the page: the
Documentation page's intro says the syntax reference is in the repo's dev Hub, as one line inside
`::: dev-only` (a link there is fine, D2).

### D8. The design document

- Sections as p800 §5 lists them: colours, type, spacing and layout, radii and elevation, motion,
  icons, patterns, accessibility, voice.
- The token tables are generated, not written: a generated section (`generated/design.ts`) reads
  `src/_engine/ui/styles/tokens.css` and renders each role's swatch in both themes with its value
  and, for text roles, its contrast on each surface (the same computation as p801's
  `tokens.test.ts`, moved to a module both import). The icons section lists the registered
  built-ins (`BuiltInIcons.ts`) with their names.
- The rules (D6's colour discipline, D7's motion, D8's accessibility of p800) are written
  prose, each with a do / don't pair.
- The app's template (`project/app/design/`) has the same headings with a sentence on what each
  should decide, and says to start from Ækasha's tokens.

### D9. The component library for developing Ækasha

- A Hub script entry (`hub/_assets/ts/components.ts`, loaded only by that page: the page's markup
  names it, as `_embed.ts` is loaded only where used) imports `aekasha/ui` and mounts a demo per
  component into the page's demo boxes (each a `.aekUi` container, p801 D2), with no engine (p800
  D1).
- `devTools/hub/assets.ts`' `build()` gets the `aekasha*` aliases (`devTools/aliases.ts`), the
  `__AEK_DEBUG__` and `__PROJECT_METADATA__` defines it needs (`false` / the metadata), and Vite's
  CSS handling for the kit's stylesheets; the entry's CSS goes into its own file next to it.
- Phase 4 shows what exists: the draggable window, the dialog, the drop-down, the toaster and the
  icons, each in both themes (and both densities once p801's tokens have them), every state the
  piece has, and its internal notes (which debug panels use it, its SBP budget line). p803-p808
  each add their components to it in their Hub phase; p803 adds the public component library page,
  rendered by the same entry.

### D10. Branches and versions

- Phase 1 is its own PR into `main` (`p802-dev-pages`), so p801 can start from `main`: p800 §6
  records the exception. Phases 2-6 continue on `p802-hub-project-section`, from `main` after
  that merge, Phase 3 after p801 merged.
- Versions: none (the Hub and `devTools/` are repo tooling): a Project entry in `CHANGELOG.md`
  per PR. Phase 4's change to the Hub's script build is tooling too.

---

## 3. Phases

Verification of each phase: `yarn test`, `yarn hub:build` (public) and the dev Hub looked at,
plus the phase's own. No engine code changes, so `yarn verify:scenes` isn't needed.

### Phase 1: dev-only pages and the Project button (its own PR, D10) — done

1. `aek:dev`, `isDev` and its inheritance, the drop in `public` after the coverage check (D1, D4);
   a dev page and its children marked, dropped in `public`, kept in `dev`; a generated page under
   a dev parent an error.
2. The link rule (D2) in `markdown.ts` and `renderPages.ts`: a public page's Markdown link to a
   dev page is an error in both modes, inside `::: dev-only` it isn't, a dev page's link isn't.

   As built (section 1):

   - One test file for both, `devTools/hub/devPages.test.ts` (fixture pages in a temp
     `hub/pages/`), instead of a new `pages.test.ts` and additions to `links.test.ts`.
   - Also: `aek:dev` with a value other than `true` warns and leaves the page public; a dev
     homepage is an error; `::: cards` naming a dev page from a public page is an error in both
     modes (its cards would link dev pages, and fail only in `public`).
   - `removeDevPages(tree)` (`pages.ts`) mutates the build's tree (pages, `byPath`, the parents'
     `children`); `build.ts` calls it in `public` right after `checkClaudeMdCoverage`.
   - Not covered: a `hub:` link in a `::: dev-only` block's title (rendered with `renderInline`
     outside the block's tokens) counts as public. No title has a link today.

3. The Project button (D3): `renderNav`, the shell placeholder, `_header.scss`; `shell.test.ts`:
   the public header unchanged, the dev one with the button and `aria-current`.
4. `hub/pages/project/index.html` with the philosophy content (D5's first row), `aek:dev`.

   As built (section 2):

   - The placeholder is `{{devNav}}` (`renderDevNav`, `shell.ts`), not `{{projectLink}}`: every
     top-level dev page becomes such a button (Project is the only one), so a second one later
     needs no shell change. It sits on the `</nav>` line, so a `public` page is byte for byte as
     before (checked: every page of a `--no-api --no-embed` build matches the previous one but
     for the `?v=` hashes and the Version page's build time). The button has a `title` (its
     tooltip where it shows the icon only); the active one also gets an inset ring.
   - The Lucide `compass` icon is in `hub/_assets/icons/` (the page's `aek:icon`).
   - Fitting the header: up to 1549 px the button shows its icon only, and the version pill is
     hidden while it's there (`.hubNavPanel:has(.hubDevNavLink)`; Version is in the nav), so the
     dev header overflows at no width the public one doesn't. The public header already pushes the
     theme toggle off-screen just past each breakpoint (960-990, 1100-1170, 1360-1400 px, measured
     with the toggle's box against the layout width): found here, not fixed (not this plan's).
   - "Local only" in a dev page's breadcrumbs (`hubBreadcrumbs_dev`), with a `title` saying the
     public Hub doesn't build the page.
   - Tests: the nav without the dev pages, the button and its `aria-current`, the empty dev nav,
     the badge (`shell.test.ts`). The look was checked in screenshots at 390, 1000, 1400 and
     1450 px, both themes.

5. `hub/CLAUDE.md` and `devTools/hub/CLAUDE.md` (the meta, the link rule, the button);
   `docs/techniques/hub-authoring.md`'s metas list. A Project entry in `CHANGELOG.md`.
6. (Added in review, 2026-10-23.) The public header's overflow found in section 2: past each
   breakpoint (960-990, 1100-1170, 1360-1400 px) the theme toggle is off-screen. Fixed in this
   branch, checked by measuring the toggle's box against the layout width at every 10 px from 960
   to 1800, in the public and the dev header; the public header changes here, so the "byte for
   byte" check of section 2 no longer holds after this step.

   As built (section 4):

   - Measured in pixels against the header's content box (not the viewport, which hid the
     overflow into the side margin), the public header overflowed at 960-1035, 1100-1220 and
     1360-1470 px, by up to 113 px; the dev header, with section 2's 1549 px rule, also by
     about 69 px at every width from 1550 (the header stops growing at its 96rem page width).
   - `$nav-collapse` stays (the homepage hero's layout uses it too). Instead, the desktop
     breakpoints moved to where the contents fit with 16 px to spare, measured as the nav's width
     minus its items' extent: the version pill hidden up to 1099 px, the nav's icons from 1250
     (was 1100), the full search box from 1500 (was 1360).
   - The dev header: the version pill hidden on every desktop width, the Project button its icon
     only below 1600 px, the search box 13rem beside its label (from 1600), and the GitHub link
     hidden up to 1099 px. The same 16 px hold there.
   - The measuring script isn't committed (a Playwright loop over a built page, in the session's
     scratchpad): `hub/CLAUDE.md` says to re-measure when the header's contents change. A
     committed check would need a browser in `yarn test`; a `verify:` mode is the place if one
     is wanted.

### Phase 2: the Project pages, `code-blocks/`, the hero links

D5's `project/aekasha/` and `project/app/` pages with their prose, D7's move with its references,
D6's hero slot. `aek:covers` on each page for the CLAUDE.md sections it explains.

### Phase 3: the design document (after p801)

D8: `generated/design.ts`, the contrast module shared with p801's test, the prose, the app's
template; p801's `font-study/` moved or removed as p801 decided.

### Phase 4: the component library (dev)

D9: the script build's aliases and CSS, `components.ts`, the page with the existing pieces.
`yarn hub:build` in `public` checks that the page and its script are absent from `dist-hub/`
(a test on the output list: no file under `project/` and no `components.js`).

### Phase 5: `CLAUDE.md`, the authoring doc, the root `CLAUDE.md`

The root `CLAUDE.md`'s Ækasha Hub section: the Project section and the dev-only pages in one
line; `hub/CLAUDE.md` (the pages, the design document's generated tables, the component
library's entry), `devTools/hub/CLAUDE.md` (the generated design section, the script build's
aliases), `docs/techniques/hub-authoring.md`.

### Phase 6: done

The changelog entry, `yarn checkVersions --against main`, mark the plan done; p800 §5's p802
entry points here. Time for the PR: `p802-hub-project-section` → `main`.

---

## 4. Risks

- **The Hub's script build importing the engine**: the kit's modules import kernel hooks
  (`addSceneHooks`, `addResizer`; `src/_engine/ui/CLAUDE.md`), added on a window's first use.
  In the Hub there's no main loop: Phase 4 checks that opening a window there needs none (the
  hooks are added, never run) and records what it finds; a kernel import the bundle can't take
  is p803's to cut (p800 D1: every component works without the engine).
- **Prose drifting from the CLAUDE.md files**: `aek:covers` and the coverage check tie each page
  to its sections, but not the content. Each page says which file is the source, and a change to
  a covered section is a reason to read the page (the root `CLAUDE.md`'s "Keep the Ækasha Hub
  current").

## Done when

`aek:dev` pages exist only in the dev Hub and a public page can't link one outside
`::: dev-only`; the Project button opens the section; the philosophy, Ækasha development, the
code block reference, the design document with generated token tables, the component library
and the app's page with its design document template are there; the hero links them in dev.
