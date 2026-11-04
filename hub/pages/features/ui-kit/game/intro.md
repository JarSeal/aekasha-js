The pieces games build again and again, for your HUD: [prompts](#input-prompts) that show the
binding for the device the player uses, [resource bars](#resource-bars),
[cooldowns](#cooldowns) and a [crosshair](#crosshairs); a [feed](#notification-feeds),
[objectives](#objective-trackers), [subtitles](#subtitles) and a [dialogue box](#dialogue-boxes);
[menus a gamepad moves through](#spatial-navigation), a [radial menu](#radial-menus), a
[pause menu](#game-menus), a [settings menu](#settings-menus) and a
[controls page](#controls-pages); [item slots](#item-slots), a [hotbar](#hotbars), an
[inventory](#inventory-grids) and [item details](#item-details); and over the world,
[anchors](#world-anchors) (nameplates, waypoints), a [compass](#compasses) and a
[minimap frame](#minimap-frames).

Each is plain DOM through CMP, works without the engine, and takes plain data: where the engine
knows something the DOM doesn't (the device the player uses, an entity's position, the camera),
a line of your code or a toolkit system feeds the piece ([wiring the engine](#wiring-the-engine)).
A keyboard, a mouse and a gamepad all work, without switching modes. Like every kit piece, each is
a `createX(props)` that returns its handle: add its `cmp` where it goes (most place themselves at
the HUD's edges) and remove it with `cmp.remove()`. Setters a game calls every frame write nothing
when the value didn't change, so call them every frame.

::: scene exampleGameHud
The game HUD example: a small arena with every piece on this page, played with a keyboard and
mouse or a gamepad, its prompts following the device.
:::
