/**
 * The value editors' checks (`editors.ts`' demos): the colour, vector and rotation fields, the
 * angle dial, the 2D pad, and the gradient and curve editors.
 */
import type { UiDemoChecks } from '../_componentChecks';

/** A colour field's text input by its name (`editors.ts`' `COLOR_ID`), its swatch and its
 * alpha's spin button, the open panel's swatches, and the box's status line */
const COLOR = (name: string) => `#hubDemoColor${name}`;
const COLOR_SWATCH = (name: string) => `.aekField:has(${COLOR(name)}) .aekColorField__swatch`;
const COLOR_ALPHA = (name: string) => `.aekField:has(${COLOR(name)}) .aekColorField__part input`;
const COLOR_PANEL_SWATCH = (n: number) =>
  `#hudRoot .aekColorPopover .aekColorPanel__picker + .aekColorPanel__group .aekColorPanel__swatch:nth-child(${n})`;
/** The picker's parts, focused in its shadow root (`expectFocus` reads the element focused there) */
const PICKER_PART = (part: string) => `[part="${part}"]`;
const COLOR_STATUS = '#hubDemoColorStatus';
/** A vector field's axis by the field's name (`editors.ts`' `VECTOR_ID`, the group's id) and
 * the axis' place (`data-axis`), its link toggle, and the box's status line */
const VECTOR_AXIS = (name: string, axis: string) =>
  `#hubDemoVector${name} .aekVectorField__axis[data-axis="${axis}"] input`;
const VECTOR_LINK = (name: string) => `#hubDemoVector${name} .aekVectorField__link`;
const VECTOR_STATUS = '#hubDemoVectorStatus';
/** A rotation or quaternion field's part by the field's name (`editors.ts`' `ROTATION_ID`,
 * the group's id) and its place (`data-axis`), and the box's status line */
const ROTATION_PART = (name: string, axis: string) =>
  `#hubDemoRotation${name} .aekVectorField__axis[data-axis="${axis}"] input`;
const ROTATION_ORDER = '#hubDemoRotationRotation .aekDropDownTrigger';
const ROTATION_STATUS = '#hubDemoRotationStatus';
/** An angle dial's control by its name (`editors.ts`' `ANGLE_ID`: the spin button's id, or
 * the dial's without one), and the box's status line */
const ANGLE = (name: string) => `#hubDemoAngle${name}`;
const ANGLE_STATUS = '#hubDemoAngleStatus';
/** A 2D pad's pad and axis by the field's name (`PAD_ID`, the row's id), and the status line */
const PAD = (name: string) => `#hubDemoPad${name} .aekPad2D__pad`;
const PAD_AXIS = (name: string, axis: string) =>
  `#hubDemoPad${name} .aekVectorField__axis[data-axis="${axis}"] input`;
const PAD_STATUS = '#hubDemoPadStatus';
/** A gradient editor's stop handle by the editor's name (`GRADIENT_ID`, the group's id) and its
 * place in the array (1-based), its row's parts, and the box's status line */
const GRADIENT_STOP = (name: string, n: number) =>
  `#hubDemoGradient${name} .aekGradientEditor__stop:nth-child(${n})`;
const GRADIENT_STOPS = (name: string) => `#hubDemoGradient${name} .aekGradientEditor__stop`;
const GRADIENT_POSITION = (name: string) =>
  `#hubDemoGradient${name} input[aria-label="Stop position"]`;
const GRADIENT_SWATCH = (name: string) => `#hubDemoGradient${name} .aekColorField__swatch`;
const GRADIENT_STATUS = '#hubDemoGradientStatus';
/** A curve editor's point by the editor's name (`CURVE_ID`, the group's id) and its place in the
 * array (1-based), its row's parts, and the box's status line */
const CURVE_POINT = (name: string, n: number) =>
  `#hubDemoCurve${name} .aekCurveEditor__point:nth-child(${n})`;
const CURVE_POINTS = (name: string) => `#hubDemoCurve${name} .aekCurveEditor__point`;
const CURVE_X = (name: string) => `#hubDemoCurve${name} input[aria-label$=" X"]`;
const CURVE_PRESETS = (name: string) => `#hubDemoCurve${name} .aekCurveEditor__presets`;
const CURVE_STATUS = '#hubDemoCurveStatus';

/** The editors group's checks by their demo's key (`data-hub-demo`) */
export const EDITORS_CHECKS: Record<string, UiDemoChecks> = {
  colorField: {
    keyboard: [
      {
        name: 'typed text is written on Enter; Escape puts the text back',
        steps: [
          { focusInBox: COLOR('Fog') },
          { press: 'ControlOrMeta+A' },
          { press: '#' },
          { press: 'f' },
          { press: '0' },
          { press: '0' },
          { press: 'Enter' },
          { expectValue: COLOR('Fog'), value: '#ff0000' },
          { expectText: COLOR_STATUS, text: 'Fog: 0xff0000 (last)' },
          { press: 'ControlOrMeta+A' },
          { press: 'x' },
          { press: 'Escape' },
          { expectValue: COLOR('Fog'), value: '#ff0000' },
          { expectFocus: COLOR('Fog') },
        ],
      },
      {
        name: 'the swatch opens the panel on the picker’s plane; the arrows step it; a palette swatch sets the colour; Escape returns',
        steps: [
          { focusInBox: COLOR_SWATCH('Fog') },
          { press: 'Enter' },
          { expectAttr: COLOR_SWATCH('Fog'), name: 'aria-expanded', value: 'true' },
          // Loaded on this first open, then focused
          { expectFocus: PICKER_PART('saturation') },
          // Saturation +1 %: h 208.5, s 20.1, v 78.0 rounded by the picker to 209, 21, 78
          { press: 'ArrowRight' },
          { expectText: COLOR_STATUS, text: 'Fog: 0x9db3c7 (last)' },
          { expectValue: COLOR('Fog'), value: '#9db3c7' },
          { press: 'Tab' },
          { expectFocus: PICKER_PART('hue') },
          // No alpha slider: the fog is a 24-bit number
          { press: 'Tab' },
          { expectFocus: COLOR_PANEL_SWATCH(1) },
          { press: 'Tab' },
          { expectFocus: COLOR_PANEL_SWATCH(2) },
          { press: 'Enter' },
          { expectText: COLOR_STATUS, text: 'Fog: 0xd7c4a3 (last)' },
          { expectAttr: COLOR_PANEL_SWATCH(2), name: 'aria-current', value: 'true' },
          // The focused swatch's tooltip is the top overlay: the first Escape closes it
          { press: 'Escape' },
          { expectCount: '#hudRoot .aekTooltip', count: 0 },
          { expectFocus: COLOR_PANEL_SWATCH(2) },
          { press: 'Escape' },
          { expectFocus: COLOR_SWATCH('Fog') },
          { expectCount: '#hudRoot .aekColorPopover', count: 0 },
          { expectValue: COLOR('Fog'), value: '#d7c4a3' },
        ],
      },
      {
        name: 'the alpha’s spin button steps it, the text following',
        steps: [
          { focusInBox: COLOR_ALPHA('Tint') },
          { press: 'ArrowUp' },
          { expectText: COLOR_STATUS, text: 'Tint: #3fd8f282 (last)' },
          { expectValue: COLOR('Tint'), value: '#3fd8f282' },
          { press: 'Shift+ArrowDown' },
          { expectValue: COLOR('Tint'), value: '#3fd8f269' },
        ],
      },
    ],
  },
  vectorField: {
    keyboard: [
      {
        name: 'the arrows step an axis; Tab goes axis by axis',
        steps: [
          { focusInBox: VECTOR_AXIS('Position', 'x') },
          { press: 'ArrowUp' },
          { expectText: VECTOR_STATUS, text: 'Position: 1.1, 2, 3 (last)' },
          { press: 'Tab' },
          { expectFocus: VECTOR_AXIS('Position', 'y') },
          { press: 'Shift+ArrowDown' },
          { expectText: VECTOR_STATUS, text: 'Position: 1.1, 1, 3 (last)' },
          { expectValue: VECTOR_AXIS('Position', 'y'), value: '1.0' },
        ],
      },
      {
        name: 'linked: an axis scales the others; the toggle after the axes unlinks them',
        steps: [
          { focusInBox: VECTOR_AXIS('Scale', 'x') },
          { press: 'ArrowUp' },
          { expectText: VECTOR_STATUS, text: 'Scale: 1.1, 1.1, 1.1 (last)' },
          { press: 'Tab' },
          { press: 'Tab' },
          { press: 'Tab' },
          { expectFocus: VECTOR_LINK('Scale') },
          { expectAttr: VECTOR_LINK('Scale'), name: 'aria-pressed', value: 'true' },
          { press: 'Space' },
          { expectAttr: VECTOR_LINK('Scale'), name: 'aria-pressed', value: 'false' },
          { press: 'Shift+Tab' },
          { expectFocus: VECTOR_AXIS('Scale', 'z') },
          { press: 'ArrowUp' },
          { expectText: VECTOR_STATUS, text: 'Scale: 1.1, 1.1, 1.2 (last)' },
        ],
      },
      {
        name: 'a typed value is written on Enter, kept to its axis’ own rules',
        steps: [
          { focusInBox: VECTOR_AXIS('Size', 'y') },
          { press: 'ControlOrMeta+A' },
          { press: '-' },
          { press: '5' },
          { press: 'Enter' },
          { expectText: VECTOR_STATUS, text: 'Size: 1920, 1 (last)' },
          { expectValue: VECTOR_AXIS('Size', 'y'), value: '1' },
        ],
      },
    ],
  },
  rotationField: {
    keyboard: [
      {
        name: 'an Euler angle steps by π / 8, shown as 22.5°; Tab reaches the order, a pick keeps the angles',
        steps: [
          { focusInBox: ROTATION_PART('Rotation', 'y') },
          { press: 'ArrowUp' },
          { expectValue: ROTATION_PART('Rotation', 'y'), value: '67.5' },
          { expectText: ROTATION_STATUS, text: 'Rotation: 0.000, 1.178, 0.000, XYZ (last)' },
          { press: 'Tab' },
          { press: 'Tab' },
          { expectFocus: ROTATION_ORDER },
          { press: 'Enter' },
          { press: 'ArrowDown' },
          { press: 'Enter' },
          { expectFocus: ROTATION_ORDER },
          { expectText: ROTATION_STATUS, text: 'Rotation: 0.000, 1.178, 0.000, YXZ (last)' },
          { expectValue: ROTATION_PART('Rotation', 'y'), value: '67.5' },
        ],
      },
      {
        name: 'a quaternion: a typed Euler angle, the raw components following',
        steps: [
          { focusInBox: ROTATION_PART('Facing', 'y') },
          { press: 'ControlOrMeta+A' },
          { press: '9' },
          { press: '0' },
          { press: 'Enter' },
          { expectText: ROTATION_STATUS, text: 'Facing: 0.000, 0.707, 0.000, 0.707 (last)' },
          {
            expectText: '#hubDemoRotationFacing .aekQuaternionField__raw',
            text: 'x 0.000, y 0.707, z 0.000, w 0.707',
          },
        ],
      },
      {
        name: 'axis-angle: the angle in degrees about the axis shown',
        steps: [
          { focusInBox: ROTATION_PART('Spin', 'angle') },
          { press: 'ControlOrMeta+A' },
          { press: '9' },
          { press: '0' },
          { press: 'Enter' },
          { expectText: ROTATION_STATUS, text: 'Spin: 0.707, 0.000, 0.000, 0.707 (last)' },
        ],
      },
    ],
  },
  angleDial: {
    keyboard: [
      {
        name: 'the spin button steps by π / 8, shown as 22.5°',
        steps: [
          { focusInBox: ANGLE('Heading') },
          { press: 'ArrowUp' },
          { expectValue: ANGLE('Heading'), value: '67.5' },
          { expectText: ANGLE_STATUS, text: 'Heading: 1.178 (last)' },
        ],
      },
      {
        name: 'a compass in degrees: a typed -90 wraps to 270',
        steps: [
          { focusInBox: ANGLE('Azimuth') },
          { press: 'ControlOrMeta+A' },
          { press: '-' },
          { press: '9' },
          { press: '0' },
          { press: 'Enter' },
          { expectValue: ANGLE('Azimuth'), value: '270' },
          { expectText: ANGLE_STATUS, text: 'Sun azimuth: 270 (last)' },
        ],
      },
      {
        name: 'without the spin button the dial is the slider: the arrows, Shift ×10, End',
        steps: [
          { focusInBox: ANGLE('Spin') },
          { press: 'ArrowRight' },
          { expectAttr: ANGLE('Spin'), name: 'aria-valuenow', value: '1' },
          { press: 'Shift+ArrowRight' },
          { expectAttr: ANGLE('Spin'), name: 'aria-valuenow', value: '11' },
          { press: 'End' },
          { expectAttr: ANGLE('Spin'), name: 'aria-valuenow', value: '180' },
          { expectText: ANGLE_STATUS, text: 'Spin: 3.142 (last)' },
        ],
      },
    ],
  },
  pad2d: {
    keyboard: [
      {
        name: 'the pad’s arrows move the point, Shift ×10; its axes follow',
        steps: [
          { focusInBox: PAD('Offset') },
          { press: 'ArrowRight' },
          { expectText: PAD_STATUS, text: 'Offset: 0.26, -0.5 (last)' },
          { press: 'Shift+ArrowUp' },
          { expectText: PAD_STATUS, text: 'Offset: 0.26, -0.4 (last)' },
          { expectValue: PAD_AXIS('Offset', 'y'), value: '-0.40' },
        ],
      },
      {
        name: 'Tab goes from the pad to its axes; y down: ArrowUp lowers y',
        steps: [
          { focusInBox: PAD('Anchor') },
          { press: 'ArrowUp' },
          { expectText: PAD_STATUS, text: 'Anchor: 50, 24 (last)' },
          { press: 'Tab' },
          { expectFocus: PAD_AXIS('Anchor', 'x') },
          { press: 'ControlOrMeta+A' },
          { press: '7' },
          { press: '5' },
          { press: 'Enter' },
          { expectText: PAD_STATUS, text: 'Anchor: 75, 24 (last)' },
        ],
      },
    ],
  },
  gradientEditor: {
    keyboard: [
      {
        name: 'a stop’s arrows move it; Insert adds one after it, focused; Delete removes it',
        steps: [
          { focusInBox: GRADIENT_STOP('Sky', 2) },
          { press: 'ArrowRight' },
          { expectAttr: GRADIENT_STOP('Sky', 2), name: 'aria-valuenow', value: '51' },
          {
            expectText: GRADIENT_STATUS,
            text: 'Sky ramp: #0b1d3a 0, #f2a65a 0.51, #9fd3ff 1 (last)',
          },
          { press: 'Insert' },
          { expectCount: GRADIENT_STOPS('Sky'), count: 4 },
          { expectFocus: GRADIENT_STOP('Sky', 3) },
          { press: 'Delete' },
          { expectCount: GRADIENT_STOPS('Sky'), count: 3 },
          { expectFocus: GRADIENT_STOP('Sky', 3) },
        ],
      },
      {
        name: 'Tab goes from the stops to the selected one’s position: a typed place',
        steps: [
          { focusInBox: GRADIENT_STOP('Sky', 3) },
          { press: 'Tab' },
          { expectFocus: GRADIENT_POSITION('Sky') },
          { press: 'ControlOrMeta+A' },
          { press: '9' },
          { press: '0' },
          { press: 'Enter' },
          { expectAttr: GRADIENT_STOP('Sky', 3), name: 'aria-valuenow', value: '90' },
          {
            expectText: GRADIENT_STATUS,
            text: 'Sky ramp: #0b1d3a 0, #f2a65a 0.5, #9fd3ff 0.9 (last)',
          },
        ],
      },
      {
        name: 'Enter on a stop opens its colour panel on the picker; Escape returns to the swatch',
        steps: [
          { focusInBox: GRADIENT_STOP('Fade', 2) },
          { press: 'Enter' },
          { expectAttr: GRADIENT_SWATCH('Fade'), name: 'aria-expanded', value: 'true' },
          { expectFocus: '[part="saturation"]' },
          { press: 'Escape' },
          { expectAttr: GRADIENT_SWATCH('Fade'), name: 'aria-expanded', value: 'false' },
          { expectFocus: GRADIENT_SWATCH('Fade') },
        ],
      },
    ],
  },
  curveEditor: {
    keyboard: [
      {
        name: 'a key’s arrows move it; Insert adds one after it, focused; Delete removes it',
        steps: [
          { focusInBox: CURVE_POINT('Falloff', 2) },
          { press: 'ArrowUp' },
          { expectAttr: CURVE_POINT('Falloff', 2), name: 'aria-valuenow', value: '0.61' },
          {
            expectText: CURVE_STATUS,
            text: 'Falloff: (0, 1), (8, 0.61), (20, 0) (last)',
          },
          { press: 'Insert' },
          { expectCount: CURVE_POINTS('Falloff'), count: 4 },
          { expectFocus: CURVE_POINT('Falloff', 3) },
          { press: 'Delete' },
          { expectCount: CURVE_POINTS('Falloff'), count: 3 },
          { expectFocus: CURVE_POINT('Falloff', 3) },
        ],
      },
      {
        name: 'Tab goes from the handles to the selected one’s X: a typed place',
        steps: [
          { focusInBox: CURVE_POINT('Easing', 2) },
          { press: 'Tab' },
          { expectFocus: CURVE_X('Easing') },
          { press: 'ControlOrMeta+A' },
          { press: '0' },
          { press: '.' },
          { press: '9' },
          { press: 'Enter' },
          {
            expectAttr: CURVE_POINT('Easing', 2),
            name: 'aria-valuetext',
            value: 'X 0.90, Y 1.00',
          },
          { expectText: CURVE_STATUS, text: 'Easing: 0.25, 0.1, 0.9, 1 (last)' },
        ],
      },
      {
        name: 'the presets menu: End and Enter pick smoothstep, the focus back on its button',
        steps: [
          { focusInBox: CURVE_PRESETS('Easing') },
          { press: 'Enter' },
          { expectAttr: CURVE_PRESETS('Easing'), name: 'aria-expanded', value: 'true' },
          { press: 'End' },
          { press: 'Enter' },
          { expectText: CURVE_STATUS, text: 'Easing: 0.333, 0, 0.667, 1 (last)' },
          { expectFocus: CURVE_PRESETS('Easing') },
        ],
      },
    ],
  },
};
