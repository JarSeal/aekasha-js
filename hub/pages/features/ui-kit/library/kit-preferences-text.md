## Kit preferences

`setKitPreferences({ root?, theme?, uiScale?, reducedMotion?, density? })` writes the player's UI
preferences on a kit root (the HUD root by default): `data-aek-theme`, `--aek-ui-scale`,
`--aek-motion` and `data-aek-density`, each left out unchanged; `getKitPreferences(root?)` reads
them back. It writes, never saves: the settings menu reports, its owner persists. Not a component:
the box is a kit root of its own, which the page's theme and density switches leave alone.

- **States:** in the page: a panel on that root in the light and the dark theme, at a UI scale of
  1.25, with reduced motion, in the compact density, and back at the defaults.
