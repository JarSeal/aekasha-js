## World anchors

[`createWorldAnchorLayer`](api:createWorldAnchorLayer) places HUD content over points in the
world: nameplates over characters, a health bar over a crate, a waypoint that stays on the
screen's edge with an arrow when it's off screen. The layer takes the camera as plain numbers, so
the kit needs no three; the toolkit's
[`registerWorldAnchorSync`](api:registerWorldAnchorSync) feeds it from your entities and the
active camera.

```ts
import { createWorldAnchorLayer, getHUDRootCMP } from 'aekasha/ui';
import { WorldAnchorComponentType, registerWorldAnchorSync } from 'aekasha/toolkit/ecs';

const layer = createWorldAnchorLayer({ cullDistance: 45 });
getHUDRootCMP().add(layer.cmp);
// One LATE_MAIN system: each entity's drawn position into its anchor, then the camera's update
registerWorldAnchorSync(world, { layer, compass });
world.addComponent(npcId, WorldAnchorComponentType.WORLD_ANCHOR, {
  anchor: layer.addAnchor({ content: nameplate, align: 'above', maxDistance: 20 }),
  offsetY: 1.1, // above the head
});
const beacon = layer.addAnchor({ content: waypoint, offScreen: 'clamp', maxDistance: 1000 });
```

::: demo worldAnchors
:::

- **The update.** `layer.update(view)` takes the camera's view-projection (a `Matrix4`'s
  `elements` as they are), the size it renders at and its position, one kept object you write
  each frame; an anchor moves only when its rounded pixel position changed. Without the sync, call
  `anchor.setPosition(x, y, z)` and `update` yourself after the render.
- **Off screen.** An anchor behind the camera or past `maxDistance` (default the layer's
  `cullDistance`) hides; `offScreen: 'clamp'` keeps it on the padded edge (`edgePadding`, 32 px)
  with an arrow turned to it. `getDistance()` is the camera's distance (a waypoint's "120 m").
- **Nearer on top.** `depthSort` puts a nearer anchor over a farther one, writing `z-index` only
  where the order changed.
- **Many anchors.** 200 anchors cost about 0.1 ms a frame (p808's measurement); the layer's
  `contain: strict` keeps its layout to itself.

| World anchors     |                                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Props             | [`WorldAnchorLayerProps`](api:WorldAnchorLayerProps), [`WorldAnchorProps`](api:WorldAnchorProps), [`WorldAnchorView`](api:WorldAnchorView) |
| Parts             | `.aekWorldAnchorLayer` (`data-placement`) of `.aekWorldAnchor`s (`data-align`) holding `__body` and `__arrow`                    |
| States            | An anchor's `data-state` (`shown`, `clamped`, `hidden`)                                                                           |
| Custom properties | `--aek-world-anchor-color`, `--aek-world-anchor-halo` (the text's outline over any scene), `--aek-world-anchor-arrow-color`, `--aek-world-anchor-layer-z` |
| Keys              | None: no pointer events either                                                                                                    |
| Assistive tech    | The content is yours, read where it is; the arrow `aria-hidden`                                                                   |

## Compasses

[`createCompass`](api:createCompass) is a strip of the bearings at the top of the HUD, scrolled by
the heading, with markers at bearings (a waypoint, an NPC).

```ts
const compass = createCompass({
  markers: { beacon: { bearing: 0, label: 'Beacon', icon: 'flag', color: '#d9c27a' } },
});
getHUDRootCMP().add(compass.cmp);
// The sync turns it with the camera; a marker's bearing from the player, each frame
compass.setMarkerBearing('beacon', getCompassBearing(beacon.x - player.x, beacon.z - player.z));
```

::: demo compass
:::

- **Bearings** are radians clockwise from north (-z; east is +x): the toolkit's
  [`getCompassBearing(dx, dz)`](api:getCompassBearing) turns a direction into one, and the sync's
  `compass` option turns the compass with the camera.
- **Markers** out of the field's view (`fov`, 120°) sit at the nearer end with an arrow (turn this
  way), or hide with `offScreen: 'hide'`. A marker without an icon is a diamond.
- **Writes.** The strip moves by one transform when the heading moved a tenth of a degree;
  nothing is measured.
- `texts` holds the shown and spoken directions, for your language.

| Compass           |                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Props             | [`CompassProps`](api:CompassProps), [`CompassMarker`](api:CompassMarker), [`CompassTexts`](api:CompassTexts)           |
| Parts             | `.aekCompass` (`data-placement`) holding `__window` (`__track`, `__strip` of `__label`s, `__markers` of `__marker`s), `__needle` and `__spoken` |
| States            | A marker's `data-edge` (`start`, `end`), `data-hidden`                                                                  |
| Custom properties | `--aek-compass-width`, `--aek-compass-height`, `--aek-compass-color`, `--aek-compass-marker-color`, `--aek-compass-needle-color`, `--aek-compass-inset`, `--aek-compass-z` |
| Keys              | None                                                                                                                    |
| Assistive tech    | The strip `aria-hidden`; the heading a hidden text ("Facing north-east"), written when the nearest direction changes, not live |

## Minimap frames

[`createMinimapFrame`](api:createMinimapFrame) is the frame for a minimap: a north mark, the
player's arrow at its centre, and zoom buttons. The map is a
[viewport](hub:features/viewports) of your scene through a camera over the player; the frame goes
into its slot element, which the viewport places.

```ts
const map = createViewport({ id: 'minimap', camera: topDownCamera, anchor: 'BOTTOM_RIGHT', size });
const frame = createMinimapFrame({ label: 'Map', onZoom: (direction) => zoomMap(direction) });
map.slotElem.append(frame.cmp.elem);
frame.setPlayerHeading(getCompassBearing(forward.x, forward.z)); // north up: the arrow turns
```

::: demo minimapFrame
:::

- **North up, or turning.** `setPlayerHeading` turns the arrow; for a map that turns with the
  player, give `setMapHeading` the player's heading too: the north mark goes round the edge.
- **Zoom.** `onZoom(1 | -1)` reports a press; the zoom is your camera's. `setZoomEnabled` disables
  a button at a limit.
- **Square.** The viewport renders into the main canvas, which the DOM can't clip to a circle; the
  frame's corners outside its rounded border are filled by the border's shadow.
- It lets the pointer through to the canvas but for its buttons.

| Minimap frame     |                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Props             | [`MinimapFrameProps`](api:MinimapFrameProps), [`MinimapFrameTexts`](api:MinimapFrameTexts)                                  |
| Parts             | `.aekMinimapFrame` holding `__border`, `__ring` (`__north`), `__player`, `__zoom` (two `__zoomButton`s) and `__spoken`     |
| Custom properties | `--aek-minimap-frame-border`, `--aek-minimap-frame-radius`                                                                   |
| Keys              | The zoom buttons' Enter and Space                                                                                            |
| Assistive tech    | A `role="group"` named by `label`; the pictures `aria-hidden`; the heading a hidden text ("Facing east"), not live          |
