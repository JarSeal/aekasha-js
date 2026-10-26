// An angle part's rules (p804 D8): a number part in degrees over a value in radians (or another
// unit), wrapping at ±180° by default. The rotation and quaternion fields' parts and the angle
// dial's; its own module, so the dial brings none of the rotation field's code or styles.
import type { NumberPart } from '../VectorField';
import { RAD_TO_DEG } from './RotationMath';

/**
 * The units a typed angle may use: degrees as they are, radians and turns converted.
 * @internal
 */
export const ANGLE_UNITS: Readonly<Record<string, number>> = {
  deg: 1,
  '°': 1,
  rad: RAD_TO_DEG,
  turn: 360,
};

/**
 * What an angle part is made from: its rules in the bound value's unit (radians, unless
 * `toDegrees` says otherwise), and its text in degrees.
 * @internal
 */
export type AnglePartProps = {
  /** Default 1° */
  step?: number;
  /** Default -180° */
  min?: number;
  /** Default 180° */
  max?: number;
  /** Default true: `[min, max)` */
  wrap?: boolean;
  precision?: number;
  format?: (degrees: number) => string;
  /** The value's unit in degrees (default `RAD_TO_DEG`; 1 for a value in degrees) */
  toDegrees?: number;
};

/**
 * An angle part's rules (p804 D8): degrees, wrapping at ±180° by default, the step, `min` and
 * `max` given in the value's unit (radians).
 * @internal
 */
export const getAnglePart = (axis: string, label: string, props: AnglePartProps): NumberPart => {
  const toDegrees = props.toDegrees ?? RAD_TO_DEG;
  // `Math.PI / 8` in degrees is 22.499999999999996: rounded, so its decimals are 22.5's
  const inDegrees = (value: number | undefined, otherwise: number) =>
    value === undefined ? otherwise : Number((value * toDegrees).toFixed(10));
  return {
    axis,
    label,
    min: inDegrees(props.min, -180),
    max: inDegrees(props.max, 180),
    wrap: props.wrap ?? true,
    step: inDegrees(props.step, 1),
    precision: props.precision,
    format: props.format,
    unit: '°',
    expressionUnits: ANGLE_UNITS,
  };
};
