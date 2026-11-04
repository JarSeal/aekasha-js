// A gamepad's family from its `Gamepad.id` (p808 D5): which labels its face buttons carry, for
// the prompts (Xbox's A B X Y, PlayStation's shapes, Nintendo's B A Y X). Its own tiny module, so
// the device tracker (InputDevice.ts) reads it without the gamepad module's renderer import.
// The browsers' ids differ: Chrome "Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product:
// 09cc)", Firefox "54c-9cc-Wireless Controller", Safari "DUALSHOCK 4 Wireless Controller".

/** A gamepad's family: the labels on its face buttons. `GENERIC` when the id names none. */
export type GamepadFamily = 'XBOX' | 'PLAYSTATION' | 'NINTENDO' | 'GENERIC';

/** The USB vendor ids, as the browsers print them (Firefox drops the leading zeros) */
const VENDOR_FAMILIES: Record<string, GamepadFamily> = {
  '45e': 'XBOX',
  '54c': 'PLAYSTATION',
  '57e': 'NINTENDO',
};

const CHROME_VENDOR = /vendor:\s*0*([0-9a-f]{1,4})\b/;
const FIREFOX_VENDOR = /^0*([0-9a-f]{1,4})-[0-9a-f]{1,4}-/;
const XBOX_NAMES = /xbox|xinput/;
const PLAYSTATION_NAMES = /playstation|dualshock|dualsense|\bps[345]\b/;
const NINTENDO_NAMES = /nintendo|switch|joy-con|pro controller/;

/**
 * A gamepad's family from its `Gamepad.id` (`GamepadInfo.id`): its USB vendor where the browser
 * gives one, else the names in it. `GENERIC` for a pad it doesn't recognize.
 * @param id the browser's name for the pad
 * @remarks Windows reports every XInput pad as an Xbox one, whatever its maker: its buttons are
 * an Xbox pad's there.
 * @example
 * ```ts
 * import { getGamepadFamily, onGamepadConnected } from 'aekasha';
 *
 * onGamepadConnected((pad) => console.log(getGamepadFamily(pad.id))); // 'PLAYSTATION'
 * ```
 */
export const getGamepadFamily = (id: string): GamepadFamily => {
  const lower = id.toLowerCase();
  const vendor = CHROME_VENDOR.exec(lower)?.[1] ?? FIREFOX_VENDOR.exec(lower)?.[1];
  if (vendor) {
    const family = VENDOR_FAMILIES[vendor];
    if (family) return family;
  }
  if (XBOX_NAMES.test(lower)) return 'XBOX';
  if (PLAYSTATION_NAMES.test(lower)) return 'PLAYSTATION';
  if (NINTENDO_NAMES.test(lower)) return 'NINTENDO';
  return 'GENERIC';
};
