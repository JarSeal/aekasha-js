## Game menu

`createGameMenu({ title, items, onBack, layout })` is a pause menu or a title screen: large buttons
in a modal dialog on the overlay stack (its focus trap and return), a spatial navigation inside it
(`navigation`, for a gamepad's d-pad) and Back on Escape, `EAST` and a visible button. An item
runs, or opens a page (more items, or the app's content: a settings menu) with Back to the item
that opened it.

- **States:** over the HUD's bounds: the pause menu in a panel and full screen, and on its Options
  page.
