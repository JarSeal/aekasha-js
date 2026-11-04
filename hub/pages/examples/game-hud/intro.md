::: scene exampleGameHud
A small arena, played with a keyboard and mouse or a gamepad, without switching modes. W A S D or
the left stick move the character, Space or SOUTH jumps, Shift or the left stick's press held
runs, C (EAST) crouches, and a right-drag or the right stick turns the camera. Walk to Mara and press E (WEST) to
talk to her, shoot the crates by the walls with the left button (the right trigger), and follow
the compass to the beacon in the north-west corner. 1 to 4 (the d-pad's left and right) pick an
item and F (NORTH) uses it, Q (the right shoulder) held opens the emotes, I (SELECT) the
inventory and Escape (START) the pause menu. Mind the fire pit.
:::

Every piece on the HUD is the UI kit's [game UI](hub:features/ui-kit/game), on `aekasha/ui`:
DOM pieces made from plain data, which the scene feeds from the game. The prompts switch with the
device the player last used, the world's UI follows the entities and the camera, the menus move
with the arrows or the d-pad, and the player's settings and bindings are kept in the browser for
the next visit. Everything the scene adds goes when it exits.

![The example's HUD: the objectives at the top left, the compass, '+25 gold' in the feed at the top right, the beacon's waypoint on the left edge, nameplates and the crates' health bars over the arena, the crosshair's kill marker on a broken crate, Mara's subtitle, the health and stamina bars with their prompts, the hotbar with the whistle's cooldown, and the minimap](game-hud.png)
