## The pieces

| Piece                                                                                           | Made with                                                                                                                                            | For                                                                          |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [Component](#components)                                                                        | [`CMP`](api:CMP)                                                                                                                                     | Any element: a panel, a button, a readout                                    |
| [HUD root](#the-hud-root)                                                                       | [`getHUDRootCMP`](api:getHUDRootCMP)                                                                                                                 | Where the app's UI goes, over the canvas                                     |
| [Button](hub:features/ui-kit/core#buttons)                                                      | [`createButton`](api:createButton)                                                                                                                   | An action: a toggle, a loading save, a hold to confirm                       |
| [Button group](hub:features/ui-kit/core#groups-and-toolbars)                                    | [`createButtonGroup`](api:createButtonGroup)                                                                                                         | Buttons joined; a toolbar of toggles with one pressed                        |
| [Link](hub:features/ui-kit/core#links)                                                          | [`createLink`](api:createLink)                                                                                                                       | A navigation: in text, to another site, or as a button                       |
| [Badge, tag](hub:features/ui-kit/core#badges-and-tags)                                          | [`createBadge`](api:createBadge), [`createTag`](api:createTag)                                                                                       | A count or a status word; a kind, a filter chip, a picked item               |
| [Key hint](hub:features/ui-kit/core#key-hints-and-input-glyphs)                                 | [`createKbd`](api:createKbd)                                                                                                                         | A shortcut's keys, with each platform's names                                |
| [Input glyph](hub:features/ui-kit/core#key-hints-and-input-glyphs)                              | [`createInputGlyph`](api:createInputGlyph)                                                                                                           | One key or mouse input in a prompt: "Press E"                                |
| [Icon](hub:features/ui-kit/core#icons)                                                          | [`registerIcon`](api:registerIcon), [`getSvgIcon`](api:getSvgIcon)                                                                                   | SVG icons by name, in the text colour                                        |
| [Spinner](hub:features/ui-kit/core#spinners-and-progress-bars)                                  | [`createSpinner`](api:createSpinner)                                                                                                                 | A wait of unknown length, in text or alone                                   |
| [Progress bar](hub:features/ui-kit/core#spinners-and-progress-bars)                             | [`createProgressBar`](api:createProgressBar)                                                                                                         | How far a task is, or that it's going on; a segmented gauge                  |
| [Skeleton](hub:features/ui-kit/core#skeletons-dividers-and-empty-states)                        | [`createSkeleton`](api:createSkeleton)                                                                                                               | A placeholder shaped like content that's still loading                       |
| [Divider](hub:features/ui-kit/core#skeletons-dividers-and-empty-states)                         | [`createDivider`](api:createDivider)                                                                                                                 | A line between two groups, across a column or down a row                     |
| [Empty state](hub:features/ui-kit/core#skeletons-dividers-and-empty-states)                     | [`createEmptyState`](api:createEmptyState)                                                                                                           | What an empty list or search shows, and what to do                           |
| [Loading overlay](hub:features/ui-kit/core#loading-overlays)                                    | [`createLoadingOverlay`](api:createLoadingOverlay)                                                                                                   | A scene loader's screen, or a panel's while it loads                         |
| [Field](hub:features/ui-kit/forms#how-a-field-works)                                            | [`FieldProps`](api:FieldProps)                                                                                                                       | What every field shares: the binding, `onChange`, its label, hint and errors |
| [Number field](hub:features/ui-kit/forms#number-fields)                                         | [`createNumberField`](api:createNumberField)                                                                                                         | A number typed, stepped or scrubbed, with expressions and units              |
| [Slider, range slider](hub:features/ui-kit/forms#sliders)                                       | [`createSlider`](api:createSlider), [`createRangeSlider`](api:createRangeSlider)                                                                     | A number on a track; a range between two thumbs                              |
| [Radio group, segmented control](hub:features/ui-kit/forms#radio-groups-and-segmented-controls) | [`createRadioGroup`](api:createRadioGroup), [`createSegmentedControl`](api:createSegmentedControl)                                                   | One value of a few                                                           |
| [Select field](hub:features/ui-kit/forms#selects-and-drop-downs)                                | [`createSelectField`](api:createSelectField)                                                                                                         | One value of a list, bound                                                   |
| [Drop-down](hub:features/ui-kit/forms#drop-downs)                                               | [`createDropDown`](api:createDropDown)                                                                                                               | A choice from a list, with the keyboard                                      |
| [Text field](hub:features/ui-kit/forms#text-fields)                                             | [`createTextField`](api:createTextField)                                                                                                             | A string, a multiline text, a search                                         |
| [Checkbox, switch](hub:features/ui-kit/forms#checkboxes-and-switches)                           | [`createCheckbox`](api:createCheckbox), [`createSwitch`](api:createSwitch)                                                                           | On or off; a setting that acts at once                                       |
| [Monitor](hub:features/ui-kit/forms#monitors)                                                   | [`createMonitor`](api:createMonitor)                                                                                                                 | A value shown as text, read on a tick                                        |
| [Colour field](hub:features/ui-kit/forms#colour-fields)                                         | [`createColorField`](api:createColorField)                                                                                                           | A colour, with a picker, a palette and the recent colours                    |
| [Vector, rotation, quaternion](hub:features/ui-kit/forms#vectors-rotations-and-quaternions)     | [`createVectorField`](api:createVectorField), [`createRotationField`](api:createRotationField), [`createQuaternionField`](api:createQuaternionField) | A position or a scale; a rotation in degrees                                 |
| [Angle dial, 2D pad](hub:features/ui-kit/forms#angle-dials-and-2d-pads)                         | [`createAngleDial`](api:createAngleDial), [`createPad2D`](api:createPad2D)                                                                           | An angle on a dial; an offset on a pad                                       |
| [Gradient editor](hub:features/ui-kit/forms#gradient-editors)                                   | [`createGradientEditor`](api:createGradientEditor)                                                                                                   | Colour stops: a sky ramp                                                     |
| [Curve editor](hub:features/ui-kit/forms#curve-editors)                                         | [`createCurveEditor`](api:createCurveEditor)                                                                                                         | An easing, or keys: a falloff, an animation curve                            |
| [Folder, fieldset](hub:features/ui-kit/forms#folders-and-fieldsets)                             | [`createFolder`](api:createFolder), [`createFieldset`](api:createFieldset)                                                                           | Fields grouped: shut away, or a form's section                               |
| [Property grid](hub:features/ui-kit/forms#property-grids)                                       | [`createPropertyGrid`](api:createPropertyGrid), [`addPropertyGridItems`](api:addPropertyGridItems)                                                   | An inspector's label column; a panel described as data                       |
| [Form](hub:features/ui-kit/forms#forms)                                                         | [`createForm`](api:createForm)                                                                                                                       | Fields checked, with an error summary, submit and reset                      |
| [Window](hub:features/ui-kit/overlays#windows)                                                  | [`openDraggableWindow`](api:openDraggableWindow)                                                                                                     | A panel the player moves, resizes, collapses and closes                      |
| [Window kind](hub:features/ui-kit/overlays#one-window-per-thing-kinds)                          | [`registerDraggableWindowKind`](api:registerDraggableWindowKind)                                                                                     | One window per thing (an entity, an item), each with its data                |
| [Dialog](hub:features/ui-kit/overlays#dialogs)                                                  | [`openDialog`](api:openDialog)                                                                                                                       | A modal window over a backdrop: a pause menu, a confirmation                 |
| [Toaster, toast](hub:features/ui-kit/overlays#toasts)                                           | [`createToaster`](api:createToaster), [`addToast`](api:addToast)                                                                                     | Short messages that come and go                                              |
| [Tooltip](hub:features/ui-kit/overlays#tooltips)                                                | [`createTooltip`](api:createTooltip)                                                                                                                 | A short text describing a control, on hover or focus                         |
| [Popover](hub:features/ui-kit/overlays#popovers)                                                | [`createPopover`](api:createPopover)                                                                                                                 | Interactive content next to its trigger: filters, a detail                   |
| [Menu](hub:features/ui-kit/overlays#menus-and-split-buttons)                                    | [`createMenu`](api:createMenu)                                                                                                                       | A button's list of actions, on / off items and choices                       |
| [Split button](hub:features/ui-kit/overlays#menus-and-split-buttons)                            | [`createSplitButton`](api:createSplitButton)                                                                                                         | An action, with its variants in a menu                                       |

The kit is in four pages, with a [component library](hub:features/ui-kit/library) that shows
every piece in every state:

::: cards features/ui-kit
:::

## Components

A component (a CMP) is an element made from props, and its handle
([`CMPHandle`](api:CMPHandle)) adds children, updates it and removes it. It's in the page once it's added
under a component that is: the app's UI goes under the HUD root, which the engine makes at boot.

```ts
import { CMP, getHUDRootCMP } from 'aekasha/ui';

const panel = getHUDRootCMP().add({ class: 'scorePanel' });
const score = panel.add({ tag: 'span', text: '0' });
panel.add({ tag: 'button', text: 'Reset', onClick: () => score.updateText('0') });

// Each frame or on change: written in place, with no allocation
score.updateText(String(points));
score.updateStyle({ '--accent': points > 100 ? '#e8833a' : '#8fa1c4' });

// Another CMP inside an html template (the html must be a function: an update makes it again)
const star = CMP({ tag: 'span', class: 'star', text: '★' });
panel.add(CMP({ html: () => `<h2>${star} High scores</h2>` }));
```

- The HUD root is a fixed, zero-size element at the canvas's top left, so each panel places
  itself (`position: fixed` and its offsets).
- Props are copied when a component is made. `updateText`, `updateStyle`, `updateClass` and
  `updateAttr` write that copy and the element in place, so a readout can update every frame;
  `update(newProps)` makes the element again and keeps the children added to it.
- `onCreateCmp` runs when the component is mounted and after each `update()`, and `onRemoveCmp`
  after `remove()`: where a component's own listeners, timers or module state are cleaned up.
- `text` is set as text. `html` is raw HTML: never put user input in it, unless the root's
  `settings.sanitizer` is set.
- A style key that starts with `--` is a custom property, which your CSS reads with `var()`.

::: warning Listeners run in the capture phase
Every listener prop (`onClick`, `onInput`, …) is added in the capture phase, and so is a
`listeners` entry unless its options say otherwise. A parent's `onClick` runs before its
child's, and a child's `stopPropagation()` doesn't stop it.
:::

## The HUD root

The HUD root is where the app's UI goes: a fixed, zero-size element over the canvas, a kit root
(see [Styling](hub:features/ui-kit/styling#the-tokens-the-whole-look)), which the engine's boot makes. [`getHUDRootCMP`](api:getHUDRootCMP)
returns it, and each panel added under it places itself. The windows, dialogs, toasts and the
overlays open in it too.

In debug mode, the editor views (the material editor) hide the HUD root's children, except one
with [`KEEP_IN_VIEWS_CLASS`](api:KEEP_IN_VIEWS_CLASS).

### Without the engine

The kit works on a page that doesn't run the engine: a menu shown before the engine starts, or a
page of your site. Make the HUD root there yourself with [`createHudRoot`](api:createHudRoot),
once per page (the engine's boot makes it in an app, and a second one throws). Each kit module
brings the kit's global styles, so there's no stylesheet to import. Register the icons the pieces
show (the windows' buttons, the toasts' kinds): [`registerBuiltInIcons`](api:registerBuiltInIcons)
registers every built-in, as the boot does in debug mode.

```ts
import { addToast, createHudRoot, createToaster, registerBuiltInIcons } from 'aekasha/ui';

registerBuiltInIcons();
const hud = createHudRoot({ slot: document.querySelector<HTMLElement>('#menuHud') ?? undefined });
hud.add(createToaster({ id: 'menuToasts' }));
addToast({ message: 'Settings saved' });
```

## Styling

Every component brings its own styles with its module, on the kit's design tokens: a dark and a
light theme, a compact density, a UI scale that follows the player's browser font size, and
reduced motion. Restyle it in plain CSS, in three ways from the broadest: the tokens, a
component's custom properties, and rules on its parts. The kit's styles are in a cascade layer
with no specificity, so any rule of yours wins. [Styling the UI kit](hub:features/ui-kit/styling)
has each way, the tokens, the themes, the fonts and a worked example.

## In a build

A build carries only the pieces the app imports, with their styles, and loads them with the code
that uses them. From the last `yarn sbp` report (gzip), for the `uiKit` embed profile, a scene
with a window, a dialog, a toast, a button and a tooltip over one box, and a small form in the
dialog:

- **The kit in the first download:** {{sbp:uiKit.group:_engine/ui}}: the HUD root and CMP, which
  the engine's boot needs.
- **What that HUD costs,** loaded with its scene: {{sbp:uiKit.chunk:assets/uiKitEmbed.js}} of
  code (the five pieces, the overlay layer and the scene's own code) and
  {{sbp:uiKit.chunk:assets/uiKitEmbed.css}} of styles.
- **What a small form adds,** loaded on the dialog's first open:
  {{sbp:uiKit.chunk:assets/uiKitEmbedForm.js}} of code and
  {{sbp:uiKit.chunk:assets/uiKitEmbedForm.css}} of styles for a property grid of five
  [fields](hub:features/ui-kit/forms#in-a-build), and {{sbp:uiKit.chunk:assets/hsva.js}} for the
  colour picker the first time its panel opens.

The [smallest build](hub:features/smallest-build) page shows how the numbers are measured and
kept under their budgets.

## Key APIs

- [`CMP`](api:CMP), [`CMPHandle`](api:CMPHandle), [`CMPProps`](api:CMPProps),
  [`getHUDRootCMP`](api:getHUDRootCMP), [`createHudRoot`](api:createHudRoot) and
  [`hasHudRoot`](api:hasHudRoot).
- The components: [Core components](hub:features/ui-kit/core#key-apis),
  [Forms and fields](hub:features/ui-kit/forms#key-apis) and
  [Windows and overlays](hub:features/ui-kit/overlays#key-apis).
- [`KIT_ROOT_CLASS`](api:KIT_ROOT_CLASS) and the tokens: [Styling the UI kit](hub:features/ui-kit/styling).

## Read more

- [The UI kit example](hub:examples/ui-kit): every piece in one scene.
- [The component library](hub:features/ui-kit/library): every piece in every state, in both
  themes and densities.
- The API reference: [`aekasha/ui`](hub:documentation/aekasha/ui).

::: claude-md
:::
