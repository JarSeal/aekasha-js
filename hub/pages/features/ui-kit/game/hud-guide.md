## Input prompts

[`createInputPrompt`](api:createInputPrompt) shows an action's binding for the device the player
uses: "[E] Interact" on the keyboard, "[X] Interact" on an Xbox pad, "[□] Interact" on a
PlayStation pad. Give it the action map's bindings as they are; the prompt draws the first one for
the prompt device with [input glyphs](hub:features/ui-kit/core#key-hints-and-input-glyphs).

```ts
import { onLastInputDeviceChange } from 'aekasha';
import { createInputPrompt, getHUDRootCMP, setPromptDevice } from 'aekasha/ui';

const interact = createInputPrompt({ bindings: map.getBindings('interact'), label: 'Interact' });
getHUDRootCMP().add(interact.cmp);
// Every prompt follows the device the player last used: a key or a click, a gamepad's button
onLastInputDeviceChange(setPromptDevice);
// After a rebinding
interact.setBindings(map.getBindings('interact'));
```

::: demo inputPrompt
:::

- **The prompt device.** `setPromptDevice({ device, family })` switches every prompt at once (and
  the [controls page's](#controls-pages) gamepad column). The engine's
  [`onLastInputDeviceChange`](api:onLastInputDeviceChange) hands it the device as it is: a mouse
  move alone doesn't switch from the gamepad (a bumped desk), a click or a key does. Touch shows
  the keyboard's binding (touch has no glyph). Fix it instead for a "Button prompts: PlayStation"
  setting.
- **The families.** A gamepad's face buttons are drawn by its family's labels (Xbox `A B X Y`,
  PlayStation's shapes, Nintendo `B A Y X` by position, a generic pad's diamond), which the
  engine reads from the pad's id ([`getGamepadFamily`](api:getGamepadFamily)); in neutral
  colours, never the brands'.
- **Bindings.** A button's keys (a chord's modifiers as glyphs), a keyboard axis' or a
  composite's keys (each part's first), a mouse button or its movement, a gamepad's button, stick
  or axis. The first binding of the device is shown, else the first the prompt can draw.

| Input prompt      |                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| Props             | [`InputPromptProps`](api:InputPromptProps), [`InputPromptBinding`](api:InputPromptBinding)        |
| Parts             | `.aekInputPrompt` holding `__glyphs` (the input glyphs) and `__label`                             |
| Custom properties | `--aek-input-prompt-gap`; the glyphs' `--aek-input-glyph-size`                                    |
| Keys              | None                                                                                              |
| Assistive tech    | Each glyph an image named by its input ("Cross button"), then the label as text                  |

### The player's preferences

A settings menu's theme, UI scale and reduced motion are the kit root's:
[`setKitPreferences`](api:setKitPreferences) writes them on the HUD root (or the `root` you give),
each one you leave out unchanged, and [`getKitPreferences`](api:getKitPreferences) reads them
back. It writes, never saves: keep the player's choices where your settings live and apply them
at the start.

```ts
setKitPreferences({ theme: 'light', uiScale: 1.25, reducedMotion: 'system' });
```

::: demo kitPreferences
:::

`theme` is `'dark'`, `'light'` or `'system'`, `uiScale` a factor on every kit size (at least 0.5),
`reducedMotion` `true`, `false` (motion on whatever the system says) or `'system'`, and `density`
`'default'` or `'compact'`. The [styling page](hub:features/ui-kit/styling) has what each one
changes.

## Resource bars

[`createResourceBar`](api:createResourceBar) shows a value a game shows all the time: health,
stamina, mana, a shield. A drop leaves a damage trail (the lost part holds, then shrinks), a heal
fills and flashes, thresholds put it in a status with a word, and `segments` draws dividers.

```ts
const health = createResourceBar({
  label: 'Health',
  max: 100,
  showValue: 'fraction', // "72 / 100" after the label
  thresholds: [
    { below: 0.25, state: 'danger', text: 'Low' }, // the lowest that holds applies
    { below: 0.5, state: 'warning', text: 'Hurt' },
  ],
});
getHUDRootCMP().add(health.cmp);
health.setValue(player.health); // every frame: nothing written when it's unchanged
```

::: demo resourceBar
:::

- **A status, not a colour.** A threshold sets `data-state` (the bar's colour) and its word,
  shown next to the label and read in the value text ("18 of 100, Low").
- **The trail.** A drop keeps the old value in a second fill for
  `--aek-resource-bar-trail-delay` (400 ms), then shrinks it; another drop during the hold starts
  it again from where it is. A heal of at least `flashAbove` of the maximum (default 5 %) fills
  and flashes, so a slow regen doesn't flash every tick. Under reduced motion both jump.
- **Not a progress bar.** It's a `role="meter"`: a value in a known range. A task's progress (a
  load) is the [progress bar](hub:features/ui-kit/core#spinners-and-progress-bars).

| Resource bar      |                                                                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Props             | [`ResourceBarProps`](api:ResourceBarProps), [`ResourceBarThreshold`](api:ResourceBarThreshold)                                                             |
| Parts             | `.aekResourceBar` holding `__header` (`__label`, `__status`, `__value`) and `__track` (`__trail`, `__fill`, `__segments`, `__flash`)                       |
| States            | `data-state` (a threshold's: `danger`, `warning`, `success`, `info`), `data-change` (`damage`, `heal`)                                                    |
| Custom properties | `--aek-resource-bar-color`, `--aek-resource-bar-trail-color`, `--aek-resource-bar-height`, `--aek-resource-bar-radius`, `--aek-resource-bar-trail-delay` |
| Keys              | None                                                                                                                                                       |
| Assistive tech    | The track is a `role="meter"` named by the label, its value text "72 of 100" (with a threshold's word), written when the rounded value changes            |

## Cooldowns

[`createCooldown`](api:createCooldown) covers an ability's button or a hotbar slot while it
recharges: a sweep uncovers it clockwise with the seconds left, then it flashes when it's ready.
The sweep is a CSS animation from the start time, so a frame costs no script.

```ts
const dash = createButton({ label: 'Dash', iconOnly: true, icon, onClick: () => useDash() });
dash.cmp.updateStyle({ position: 'relative' });
const cooldown = createCooldown({ target: dash.cmp, onReady: () => playSound('ready') });
dash.cmp.add(cooldown.cmp);

const useDash = () => {
  if (cooldown.isRunning()) return; // the cooldown marks the button, it blocks nothing
  cooldown.start(4000);
};
```

::: demo cooldown
:::

- **It blocks nothing.** The target is `aria-disabled` and described ("Ready in 3 seconds",
  written once a second) while it runs; your action checks `isRunning()`.
- **Saved and restored.** `start(durationMs, elapsedMs)` starts a run part of the way through;
  `getRemainingMs()` is what to save. `cancel()` ends it without `onReady`.
- **Reduced motion** steps the sweep once a second: the time left is information, so it stays.

| Cooldown          |                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Props             | [`CooldownProps`](api:CooldownProps)                                                                                   |
| Parts             | `.aekCooldown` holding `__sweep` (the shade) and `__time` (the seconds)                                                |
| States            | `data-state` (`running`, `ready`)                                                                                      |
| Custom properties | `--aek-cooldown-shade` (the covered part), `--aek-cooldown-color` (the seconds)                                        |
| Keys              | None (the target's own)                                                                                                |
| Assistive tech    | The sweep and the seconds `aria-hidden`; the target `aria-disabled` with its "Ready in 3 seconds" description, put back after |

## Crosshairs

[`createCrosshair`](api:createCrosshair) is a reticle at the centre of the HUD's bounds (the
window, or a mounted engine's container): a cross, a dot, a circle or a chevron, drawn with CSS.

```ts
const crosshair = createCrosshair({ shape: 'cross', gap: 5 });
getHUDRootCMP().add(crosshair.cmp);
// Every frame
crosshair.setSpread(weapon.bloom * 12); // nothing written when unchanged
crosshair.setState(isOverEnemy ? 'target' : 'default');
// On a hit
crosshair.showHitMarker(wasKill ? 'kill' : 'hit');
```

::: demo crosshair
:::

- **Not colour alone.** A target puts a ring round it, `'blocked'` (something it can't act on) a
  slash; a hit marker's kind (`hit`, `critical`, `kill`) is a larger, heavier X.
- **Motion.** The spread eases over `--aek-motion-fast`; a hit marker pops and fades in 250 ms,
  fixed (it's information). Under reduced motion the spread jumps and the marker shows still for
  the same time.

| Crosshair         |                                                                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Props             | [`CrosshairProps`](api:CrosshairProps)                                                                                                                                                                       |
| Parts             | `.aekCrosshair` holding four `__arm`s (`data-arm`), `__dot`, `__ring`, `__slash` and `__hit` (its four `__hitArm`s)                                                                                          |
| States            | `data-shape`, `data-state` (`default`, `target`, `blocked`); `__hit`'s `data-kind`                                                                                                                           |
| Custom properties | `--aek-crosshair-color`, `--aek-crosshair-outline` (a 1 px edge so it shows on any scene), `--aek-crosshair-target-color`, `--aek-crosshair-hit-color`, `--aek-crosshair-gap`, `--aek-crosshair-length`, `--aek-crosshair-thickness` |
| Keys              | None                                                                                                                                                                                                         |
| Assistive tech    | `aria-hidden`: an aim point for the pointer, which the game says otherwise (its sounds, its feed)                                                                                                            |
