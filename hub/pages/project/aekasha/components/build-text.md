## In a build

What the kit adds, from the last `yarn sbp` report (gzip). The report measures the kit as a whole,
not a piece at a time: `yarn sbp --profile uiKit --why _engine/ui` lists its modules.

- **The app** (`app` profile): the kit's code in the first download is {{sbp:app.group:_engine/ui}}
  (budget {{sbp:app.budget:_engine/ui}}); the pieces load later, with the code that uses them. The
  built-in icons have a zero budget in the first download (`sbp.config.ts`): they register only in
  the debug env.
- **The UI kit embed** (`uiKit` profile, which `yarn verify:embed` checks): the HUD root and CMP in
  the first download, {{sbp:uiKit.group:_engine/ui}} (budget {{sbp:uiKit.budget:_engine/ui}}); the
  window, dialog, drop-down and toaster in its scene's chunk, {{sbp:uiKit.chunk:assets/uiKitEmbed.js}}
  with its scene's code (budget {{sbp:uiKit.budget:assets/uiKitEmbed.js}}), and their styles,
  {{sbp:uiKit.chunk:assets/uiKitEmbed.css}}.
