The fields a settings menu, an inspector or an editor panel is built from, each bound to a value
of yours: [numbers and sliders](#number-fields), [choices](#radio-groups-and-segmented-controls)
and [selects](#selects-and-drop-downs), [text](#text-fields), [checkboxes and switches](#checkboxes-and-switches)
and read-only [monitors](#monitors); value editors for [colours](#colour-fields),
[vectors and rotations](#vectors-rotations-and-quaternions), [angles and 2D points](#angle-dials-and-2d-pads),
[gradients](#gradient-editors) and [curves](#curve-editors); and the containers that hold them:
[folders and fieldsets](#folders-and-fieldsets), the [property grid](#property-grids) and a
validated [form](#forms).

```ts
import { createCheckbox, createColorField, createPropertyGrid, createSlider } from 'aekasha/ui';

const grid = createPropertyGrid({
  children: [
    createSlider({ label: 'Speed', target: spinner, key: 'speed', min: 0, max: 10, step: 0.1 }),
    createColorField({ label: 'Colour', target: material, key: 'color', colorSpace: 'linear' }),
    createCheckbox({ label: 'Wireframe', target: material, key: 'wireframe' }),
  ],
});
settingsPanel.add(grid.cmp);

// The values changed elsewhere: read them again (a changed field flashes once)
grid.refresh();
```

Every field is bound the same way, writes the same events and has the same handle, so once you
know one you know them all ([how a field works](#how-a-field-works), and in full,
[binding values](hub:features/ui-kit/forms/binding)). They're plain DOM, work with
the keyboard and assistive tech, and each is its own module: a build carries only the fields the
app makes. Each section has a live demo, and the [component library](hub:features/ui-kit/library)
shows every field in every state.
