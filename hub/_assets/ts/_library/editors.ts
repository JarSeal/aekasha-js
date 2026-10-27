/**
 * The component library's value editors (the Hub's `features/ui-kit/forms/` editors guide): the
 * colour field, the vector, rotation and quaternion fields, the angle dial, the 2D pad, and the
 * gradient and curve editors.
 */
import {
  createBindingScheduler,
  createButton,
  createColorField,
  createAngleDial,
  createCurveEditor,
  createGradientEditor,
  createPad2D,
  createQuaternionField,
  createRotationField,
  createVectorField,
  setRecentColors,
  evaluateGradient,
  evaluateCurve,
} from 'aekasha/ui';
import { ID_PREFIX, addGroup, addButton, addKitRoot } from './page';
import type { Demo } from './page';

// --- Colour field ---

const COLOR_ID = (name: string) => `${ID_PREFIX}Color${name}`;
const COLOR_PALETTE = ['#9fb4c7', '#d7c4a3', '#3a4a5c', '#e07a5f', '#81b29a', '#f2cc8f'];

/** In the page: colour fields in each of the three forms, each write in the box's status line; a
 * kit button changes the sun from outside and refreshes (the flash); the recent colours seeded as
 * an owner would restore them */
const initColorFieldDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const scheduler = createBindingScheduler();
  const status = document.createElement('p');
  status.id = COLOR_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  /** A value as the status line says it: a number in hex, an object's floats to 3 decimals */
  const sayColor = (value: unknown) => {
    if (typeof value === 'number') return `0x${value.toString(16).padStart(6, '0')}`;
    if (typeof value === 'object' && value) {
      return Object.values(value as Record<string, number>)
        .map((channel) => channel.toFixed(3))
        .join(', ');
    }
    return String(value);
  };
  const report = (label: string) => (value: unknown, change: { last: boolean }) => {
    status.textContent = `${label}: ${sayColor(value)} (${change.last ? 'last' : 'step'})`;
  };
  setRecentColors(['#ffd166', '#06d6a0', '#118ab2']);
  // A THREE.Color's shape: linear floats, written in place
  const scene = { fog: 0x9fb4c7, tint: '#3fd8f280', sun: { r: 1, g: 0.6, b: 0.3 }, intensity: 3 };
  const row = (label: string, ...elems: HTMLElement[]) => {
    const group = addGroup(root, label);
    group.classList.add('hubDemoFields');
    group.append(...elems);
    return group;
  };
  const fog = createColorField({
    id: COLOR_ID('Fog'),
    label: 'Fog',
    target: scene,
    key: 'fog',
    palette: COLOR_PALETTE,
    hint: 'A 24-bit number, as getHex() gives',
    scheduler,
    onChange: report('Fog'),
  });
  const fogRow = row('A number, with a palette and the recent colours', fog.cmp.elem);
  addButton(fogRow, 'The fog’s panel open', () =>
    fog.cmp.elem.querySelector<HTMLElement>('.aekColorField__swatch')?.click()
  );
  const tint = createColorField({
    id: COLOR_ID('Tint'),
    label: 'Tint',
    target: scene,
    key: 'tint',
    scheduler,
    onChange: report('Tint'),
  });
  const tintRow = row('A hex string with alpha', tint.cmp.elem);
  addButton(tintRow, 'The tint’s panel open', () =>
    tint.cmp.elem.querySelector<HTMLElement>('.aekColorField__swatch')?.click()
  );
  const sun = createColorField({
    id: COLOR_ID('Sun'),
    label: 'Sun',
    target: scene,
    key: 'sun',
    colorSpace: 'linear',
    intensity: {
      target: scene,
      key: 'intensity',
      min: 0,
      step: 0.1,
      onChange: (value, { last }) => {
        status.textContent = `Intensity: ${value} (${last ? 'last' : 'step'})`;
      },
    },
    scheduler,
    onChange: report('Sun'),
  });
  const change = createButton({
    id: COLOR_ID('Change'),
    label: 'Change the sun from outside',
    size: 'sm',
    onClick: () => {
      scene.sun = { r: 0.2, g: 0.4, b: 1 };
      scene.intensity = 1.5;
      scheduler.refresh();
    },
  });
  row('Linear floats (a THREE.Color) with an intensity', sun.cmp.elem, change.cmp.elem);
  const invalid = createColorField({ id: COLOR_ID('Invalid'), label: 'Accent', value: '#e07a5f' });
  invalid.setError('Too close to the background');
  row(
    'An error, and disabled',
    invalid.cmp.elem,
    createColorField({ label: 'Locked', value: 0x3a4a5c, disabled: true }).cmp.elem
  );
  root.append(status);
};

// --- Vector field ---

const VECTOR_ID = (name: string) => `${ID_PREFIX}Vector${name}`;

/** In the page: vector fields bound to one object, each write in the box's status line; a kit
 * button moves the position from outside and refreshes (the flash) */
const initVectorFieldDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const scheduler = createBindingScheduler();
  const status = document.createElement('p');
  status.id = VECTOR_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  const report = (label: string) => (value: unknown, change: { last: boolean }) => {
    const axes = Array.isArray(value) ? value : Object.values(value as Record<string, number>);
    status.textContent = `${label}: ${axes.join(', ')} (${change.last ? 'last' : 'step'})`;
  };
  // A mesh's shape: its position and scale, objects written in place
  const mesh = {
    position: { x: 1, y: 2, z: 3 },
    scale: { x: 1, y: 1, z: 1 },
    size: [1920, 1080],
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
  };
  const row = (label: string, ...elems: HTMLElement[]) => {
    const group = addGroup(root, label);
    group.classList.add('hubDemoFields');
    group.append(...elems);
  };
  const move = createButton({
    id: VECTOR_ID('Move'),
    label: 'Move it from outside',
    size: 'sm',
    onClick: () => {
      mesh.position.x = -4;
      mesh.position.z = 0.5;
      scheduler.refresh();
    },
  });
  row(
    'An { x, y, z } object, step 0.1',
    createVectorField({
      id: VECTOR_ID('Position'),
      label: 'Position',
      target: mesh,
      key: 'position',
      step: 0.1,
      scheduler,
      onChange: report('Position'),
    }).cmp.elem,
    move.cmp.elem
  );
  row(
    'Linked: one axis scales the others',
    createVectorField({
      id: VECTOR_ID('Scale'),
      label: 'Scale',
      target: mesh,
      key: 'scale',
      min: 0.1,
      step: 0.1,
      linkable: true,
      linked: true,
      hint: 'The link toggle after the axes',
      onChange: report('Scale'),
    }).cmp.elem
  );
  row(
    'An array, each axis named, with its own rules',
    createVectorField({
      id: VECTOR_ID('Size'),
      label: 'Size',
      target: mesh,
      key: 'size',
      step: 1,
      unit: 'px',
      axes: { x: { label: 'W', min: 1 }, y: { label: 'H', min: 1 } },
      onChange: report('Size'),
    }).cmp.elem
  );
  row(
    'Four axes',
    createVectorField({
      id: VECTOR_ID('Raw'),
      label: 'Raw quaternion',
      target: mesh,
      key: 'quaternion',
      min: -1,
      max: 1,
      step: 0.01,
      onChange: report('Raw quaternion'),
    }).cmp.elem
  );
  const invalid = createVectorField({ id: VECTOR_ID('Invalid'), label: 'Spawn', value: [0, -50] });
  invalid.setError('Below the level');
  row(
    'An error, and disabled',
    invalid.cmp.elem,
    createVectorField({ label: 'Locked', value: { x: 1, y: 1 }, disabled: true }).cmp.elem
  );
  root.append(status);
};

// --- Rotation and quaternion fields ---

const ROTATION_ID = (name: string) => `${ID_PREFIX}Rotation${name}`;

/** In the page: an Euler and quaternions in degrees, each write in the box's status line (the
 * radians and components to 3 decimals); a kit button turns the facing from outside (the flash) */
const initRotationFieldDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const scheduler = createBindingScheduler();
  const status = document.createElement('p');
  status.id = ROTATION_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  const report = (label: string) => (value: unknown, change: { last: boolean }) => {
    const parts = Object.values(value as Record<string, number | string>).map((part) =>
      typeof part === 'number' ? part.toFixed(3) : part
    );
    status.textContent = `${label}: ${parts.join(', ')} (${change.last ? 'last' : 'step'})`;
  };
  // A mesh's shape: a THREE.Euler's and a THREE.Quaternion's, written in place
  const body = {
    rotation: { x: 0, y: Math.PI / 4, z: 0, order: 'XYZ' },
    facing: { x: 0, y: 0, z: 0, w: 1 },
    spin: { x: 0, y: 0, z: 0, w: 1 },
  };
  const row = (label: string, ...elems: HTMLElement[]) => {
    const group = addGroup(root, label);
    group.classList.add('hubDemoFields');
    group.append(...elems);
  };
  row(
    'An Euler in degrees, its step π / 8 (Tweakpane’s), with its order',
    createRotationField({
      id: ROTATION_ID('Rotation'),
      label: 'Rotation',
      target: body,
      key: 'rotation',
      step: Math.PI / 8,
      showOrder: true,
      onChange: report('Rotation'),
    }).cmp.elem
  );
  const turn = createButton({
    id: ROTATION_ID('Turn'),
    label: 'Turn it from outside',
    size: 'sm',
    onClick: () => {
      // Half a turn about Y
      body.facing = { x: 0, y: 1, z: 0, w: 0 };
      scheduler.refresh();
    },
  });
  row(
    'A quaternion as Euler angles, its raw components under them',
    createQuaternionField({
      id: ROTATION_ID('Facing'),
      label: 'Facing',
      target: body,
      key: 'facing',
      showRaw: true,
      scheduler,
      onChange: report('Facing'),
    }).cmp.elem,
    turn.cmp.elem
  );
  row(
    'A quaternion as an axis and an angle',
    createQuaternionField({
      id: ROTATION_ID('Spin'),
      label: 'Spin',
      target: body,
      key: 'spin',
      edit: 'axisAngle',
      onChange: report('Spin'),
    }).cmp.elem
  );
  row(
    'Disabled',
    createRotationField({
      label: 'Locked',
      value: { x: 0, y: Math.PI / 2, z: 0 },
      disabled: true,
    }).cmp.elem
  );
  root.append(status);
};

// --- Angle dial ---

const ANGLE_ID = (name: string) => `${ID_PREFIX}Angle${name}`;

/** In the page: dials in radians and in degrees, each write in the box's status line (to 3
 * decimals); a kit button turns the heading from outside (the flash) */
const initAngleDialDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const scheduler = createBindingScheduler();
  const status = document.createElement('p');
  status.id = ANGLE_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  const report = (label: string) => (value: number, change: { last: boolean }) => {
    status.textContent = `${label}: ${Number(value.toFixed(3))} (${change.last ? 'last' : 'step'})`;
  };
  // A body's yaw in radians, a sun's azimuth in degrees
  const scene = { heading: Math.PI / 4, azimuth: 160, spin: 0, hatch: Math.PI / 6 };
  const row = (label: string, ...elems: HTMLElement[]) => {
    const group = addGroup(root, label);
    group.classList.add('hubDemoFields');
    group.append(...elems);
  };
  const turn = createButton({
    id: ANGLE_ID('Turn'),
    label: 'Turn it from outside',
    size: 'sm',
    onClick: () => {
      scene.heading = -Math.PI / 2;
      scheduler.refresh();
    },
  });
  row(
    'Radians, its step π / 8 (Tweakpane’s): 0 at the right, anticlockwise',
    createAngleDial({
      id: ANGLE_ID('Heading'),
      label: 'Heading',
      target: scene,
      key: 'heading',
      step: Math.PI / 8,
      scheduler,
      onChange: report('Heading'),
    }).cmp.elem,
    turn.cmp.elem
  );
  row(
    'A compass in degrees, 0 to 360: 0 at the top, clockwise',
    createAngleDial({
      id: ANGLE_ID('Azimuth'),
      label: 'Sun azimuth',
      target: scene,
      key: 'azimuth',
      angleUnit: 'degrees',
      min: 0,
      max: 360,
      convention: 'compass',
      hint: 'Shift snaps a drag to 15°',
      onChange: report('Sun azimuth'),
    }).cmp.elem
  );
  row(
    'Without the spin button: the dial is the slider',
    createAngleDial({
      id: ANGLE_ID('Spin'),
      label: 'Spin',
      target: scene,
      key: 'spin',
      showInput: false,
      onChange: report('Spin'),
    }).cmp.elem
  );
  row(
    'Clamped to a quarter turn (no wrap)',
    createAngleDial({
      id: ANGLE_ID('Hatch'),
      label: 'Hatch angle',
      target: scene,
      key: 'hatch',
      min: 0,
      max: Math.PI / 2,
      wrap: false,
      onChange: report('Hatch angle'),
    }).cmp.elem
  );
  const invalid = createAngleDial({ label: 'Tilt', value: Math.PI / 3 });
  invalid.setError('Steeper than the slope allows');
  row(
    'An error, and disabled',
    invalid.cmp.elem,
    createAngleDial({ label: 'Locked', value: -Math.PI / 4, disabled: true }).cmp.elem
  );
  root.append(status);
};

// --- 2D pad ---

const PAD_ID = (name: string) => `${ID_PREFIX}Pad${name}`;

/** In the page: an offset with y up and a screen anchor with y down, each write in the box's
 * status line; a kit button moves the offset from outside (the flash) */
const initPad2DDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const scheduler = createBindingScheduler();
  const status = document.createElement('p');
  status.id = PAD_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  const report =
    (label: string) => (value: { x: number; y: number }, change: { last: boolean }) => {
      const axes = [value.x, value.y].map((axis) => Number(axis.toFixed(3)));
      status.textContent = `${label}: ${axes.join(', ')} (${change.last ? 'last' : 'step'})`;
    };
  // A THREE.Vector2's shape, written in place
  const layout = { offset: { x: 0.25, y: -0.5 }, anchor: { x: 50, y: 25 } };
  const row = (label: string, ...elems: HTMLElement[]) => {
    const group = addGroup(root, label);
    group.classList.add('hubDemoFields');
    group.append(...elems);
  };
  const move = createButton({
    id: PAD_ID('Move'),
    label: 'Move it from outside',
    size: 'sm',
    onClick: () => {
      layout.offset.x = -0.75;
      layout.offset.y = 0.75;
      scheduler.refresh();
    },
  });
  row(
    'An offset, -1 to 1 by 0.01, y up (the defaults)',
    createPad2D({
      id: PAD_ID('Offset'),
      label: 'Offset',
      target: layout,
      key: 'offset',
      scheduler,
      onChange: report('Offset'),
    }).cmp.elem,
    move.cmp.elem
  );
  row(
    'Screen coordinates: 0 to 100 px, y down',
    createPad2D({
      id: PAD_ID('Anchor'),
      label: 'Anchor',
      target: layout,
      key: 'anchor',
      min: 0,
      max: 100,
      step: 1,
      unit: 'px',
      invertY: true,
      hint: 'The arrows move the point; the axes type it',
      onChange: report('Anchor'),
    }).cmp.elem
  );
  row(
    'Disabled',
    createPad2D({ label: 'Locked', value: { x: -0.5, y: 0.5 }, disabled: true }).cmp.elem
  );
  root.append(status);
};

// --- Gradient editor ---

const GRADIENT_ID = (name: string) => `${ID_PREFIX}Gradient${name}`;

/** In the page: a sky ramp and a fade, each write in the box's status line (the stops), and the
 * ramp's colour at a quarter through `evaluateGradient`; a kit button shifts it from outside */
const initGradientEditorDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const scheduler = createBindingScheduler();
  const status = document.createElement('p');
  status.id = GRADIENT_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  const sample = document.createElement('p');
  sample.id = GRADIENT_ID('Sample');
  sample.className = 'hubDemoLine';
  const sampled = { r: 0, g: 0, b: 0, a: 1 };
  const byte = (channel: number) =>
    Math.round(channel * 255)
      .toString(16)
      .padStart(2, '0');
  const showSample = () => {
    evaluateGradient(sky.ramp, 0.25, sampled);
    sample.textContent = `evaluateGradient(ramp, 0.25): #${byte(sampled.r)}${byte(sampled.g)}${byte(sampled.b)}`;
  };
  const report =
    (label: string) =>
    (value: { stops: { t: number; color: string }[] }, change: { last: boolean }) => {
      const stops = value.stops.map((stop) => `${stop.color} ${Number(stop.t.toFixed(3))}`);
      status.textContent = `${label}: ${stops.join(', ')} (${change.last ? 'last' : 'step'})`;
      showSample();
    };
  // A sky's colours through the day, and a fade's alpha
  const sky = {
    ramp: {
      stops: [
        { t: 0, color: '#0b1d3a' },
        { t: 0.5, color: '#f2a65a' },
        { t: 1, color: '#9fd3ff' },
      ],
    },
    fade: {
      stops: [
        { t: 0, color: '#3fd8f200' },
        { t: 1, color: '#3fd8f2ff' },
      ],
    },
  };
  const row = (label: string, ...elems: HTMLElement[]) => {
    const group = addGroup(root, label);
    group.classList.add('hubDemoFields');
    group.append(...elems);
  };
  const shift = createButton({
    id: GRADIENT_ID('Shift'),
    label: 'Shift it from outside',
    size: 'sm',
    onClick: () => {
      sky.ramp.stops[1].t = 0.3;
      scheduler.refresh();
      showSample();
    },
  });
  row(
    'A sky ramp, three stops, with a palette',
    createGradientEditor({
      id: GRADIENT_ID('Sky'),
      label: 'Sky ramp',
      target: sky,
      key: 'ramp',
      palette: ['#0b1d3a', '#f2a65a', '#9fd3ff', '#ffffff'],
      scheduler,
      onChange: report('Sky ramp'),
    }).cmp.elem,
    shift.cmp.elem
  );
  row(
    'With alpha: a fade',
    createGradientEditor({
      id: GRADIENT_ID('Fade'),
      label: 'Fade',
      target: sky,
      key: 'fade',
      alpha: true,
      hint: 'A press on the bar adds a stop; Delete removes the focused one',
      onChange: report('Fade'),
    }).cmp.elem
  );
  row(
    'Disabled',
    createGradientEditor({
      label: 'Locked',
      value: {
        stops: [
          { t: 0, color: '#000000' },
          { t: 1, color: '#ffffff' },
        ],
      },
      disabled: true,
    }).cmp.elem
  );
  showSample();
  root.append(status, sample);
};

// --- Curve editor ---

const CURVE_ID = (name: string) => `${ID_PREFIX}Curve${name}`;

/** In the page: an easing with the presets and a falloff as keys, each write in the box's status
 * line, and the easing's value at the middle through `evaluateCurve`; a kit button sets the
 * easing from outside */
const initCurveEditorDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const scheduler = createBindingScheduler();
  const status = document.createElement('p');
  status.id = CURVE_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  const sample = document.createElement('p');
  sample.id = CURVE_ID('Sample');
  sample.className = 'hubDemoLine';
  const showSample = () => {
    sample.textContent = `evaluateCurve(easing, 0.5): ${evaluateCurve(curves.easing, 0.5).toFixed(3)}`;
  };
  const round = (n: number) => Number(n.toFixed(3));
  const report =
    (label: string) =>
    (
      value: number[] | { x: number; y: number; inTangent?: number; outTangent?: number }[],
      change: { last: boolean }
    ) => {
      const text = value
        .map((part) =>
          typeof part === 'number' ? `${round(part)}` : `(${round(part.x)}, ${round(part.y)})`
        )
        .join(', ');
      status.textContent = `${label}: ${text} (${change.last ? 'last' : 'step'})`;
      showSample();
    };
  // CSS's `ease`, and a light's falloff over 20 m
  const curves = {
    easing: [0.25, 0.1, 0.25, 1] as [number, number, number, number],
    falloff: [
      { x: 0, y: 1, outTangent: 0 },
      { x: 8, y: 0.6 },
      { x: 20, y: 0 },
    ],
  };
  const row = (label: string, ...elems: HTMLElement[]) => {
    const group = addGroup(root, label);
    group.classList.add('hubDemoFields');
    group.append(...elems);
  };
  const reset = createButton({
    id: CURVE_ID('Reset'),
    label: 'Set it from outside',
    size: 'sm',
    onClick: () => {
      curves.easing.splice(0, 4, 0.42, 0, 0.58, 1);
      scheduler.refresh();
      showSample();
    },
  });
  row(
    'An easing, CSS’s cubic-bezier, with the presets',
    createCurveEditor({
      id: CURVE_ID('Easing'),
      label: 'Easing',
      target: curves,
      key: 'easing',
      scheduler,
      onChange: report('Easing'),
    }).cmp.elem,
    reset.cmp.elem
  );
  row(
    'Keys: a falloff over 20 m',
    createCurveEditor({
      id: CURVE_ID('Falloff'),
      label: 'Falloff',
      target: curves,
      key: 'falloff',
      axes: { x: { min: 0, max: 20, step: 0.1 } },
      hint: 'A press on the plot adds a key; Delete removes the focused one',
      onChange: report('Falloff'),
    }).cmp.elem
  );
  row(
    'Disabled',
    createCurveEditor({
      label: 'Locked',
      value: [0, 0, 0.58, 1],
      disabled: true,
    }).cmp.elem
  );
  showSample();
  root.append(status, sample);
};

/** The editors group's demos by their box's key (`data-hub-demo`) */
export const EDITORS_DEMOS: Record<string, Demo> = {
  colorField: initColorFieldDemo,
  vectorField: initVectorFieldDemo,
  rotationField: initRotationFieldDemo,
  angleDial: initAngleDialDemo,
  pad2d: initPad2DDemo,
  gradientEditor: initGradientEditorDemo,
  curveEditor: initCurveEditorDemo,
};
