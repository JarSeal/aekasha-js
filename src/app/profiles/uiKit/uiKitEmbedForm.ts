import * as THREE from 'three/webgpu';
import { getECSWorld, getMaterial } from 'aekasha';
import {
  createCheckbox,
  createColorField,
  createNumberField,
  createPropertyGrid,
  createSelectField,
  createSlider,
} from 'aekasha/ui';

/**
 * The uiKit embed's form (p804 D12): a property grid of a slider, a number field, a checkbox, a
 * select and a colour field bound to the box, in the dialog. Its own module, which the dialog's
 * first open imports, so a build gives the fields their own chunk (`assets/uiKitEmbedForm.js`):
 * what a small form costs on top of the HUD, with the colour picker a chunk of its own again.
 */

/** The select's class, which `yarn verify:embed` finds its trigger and list by
 * (`devTools/verify/embed.ts`' UI_KIT: change it there too) */
const SHADE_CLASS = 'uiKitEmbedShade';

const RAD_TO_DEG = 180 / Math.PI;
const SHADES = [
  { label: 'Dawn', value: 0xe8a87c },
  { label: 'Teal', value: 0x3fa7a0 },
  { label: 'Dusk', value: 0x8f6bd1 },
];

/** The box's turn and tilt in degrees, kept here so the fields show what they set */
type BoxPose = { turn: number; tilt: number };

const euler = new THREE.Euler();
const rotation = new THREE.Quaternion();

/**
 * The form's grid, bound to the box: its turn (a slider) and tilt (a number field) in degrees, its
 * material's wireframe and colour, and a shade of three that writes the colour too (the colour
 * field shows it, and the shade shows "Custom" for any other colour).
 * @param boxId the box's entity id
 * @param materialId its material's id
 * @param pose its turn and tilt now: the fields write them back as they change
 */
export const createBoxForm = (boxId: number, materialId: string, pose: BoxPose) => {
  const material = getMaterial(materialId);
  const standard = material instanceof THREE.MeshStandardMaterial ? material : null;
  const setPose = () => {
    euler.set(pose.tilt / RAD_TO_DEG, pose.turn / RAD_TO_DEG, 0);
    getECSWorld().setTransform(boxId, { rot: rotation.setFromEuler(euler) });
  };
  const getColor = () => standard?.color.getHex() ?? 0;
  const setColor = (hex: number) => standard?.color.setHex(hex);

  const grid = createPropertyGrid({
    children: [
      createSlider({
        label: 'Turn',
        target: pose,
        key: 'turn',
        min: -180,
        max: 180,
        step: 1,
        unit: '°',
        onChange: setPose,
      }),
      createNumberField({
        label: 'Tilt',
        target: pose,
        key: 'tilt',
        min: -90,
        max: 90,
        step: 1,
        unit: '°',
        onChange: setPose,
      }),
      createCheckbox({
        label: 'Wireframe',
        get: () => standard?.wireframe ?? false,
        set: (on) => {
          if (!standard) return;
          standard.wireframe = on;
          standard.needsUpdate = true;
        },
      }),
      createSelectField({
        label: 'Shade',
        get: getColor,
        set: setColor,
        options: SHADES,
        placeholder: 'Custom',
        class: SHADE_CLASS,
        // The colour field shows the shade picked (a flash: a change from outside)
        onChange: () => grid.refresh(),
      }),
      createColorField({
        label: 'Colour',
        get: getColor,
        set: setColor,
        palette: SHADES.map((shade) => `#${shade.value.toString(16).padStart(6, '0')}`),
        onChange: () => grid.refresh(),
      }),
    ],
  });
  return grid;
};
