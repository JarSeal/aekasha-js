import { describe, expect, it } from 'vitest';
import { getGamepadFamily } from './GamepadFamily';

describe('getGamepadFamily', () => {
  it.each([
    ['Xbox 360 Controller (XInput STANDARD GAMEPAD)', 'XBOX'],
    ['Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', 'XBOX'],
    ['45e-b13-Xbox Wireless Controller', 'XBOX'],
    ['Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)', 'PLAYSTATION'],
    ['54c-9cc-Wireless Controller', 'PLAYSTATION'],
    ['DUALSHOCK 4 Wireless Controller', 'PLAYSTATION'],
    ['DualSense Wireless Controller', 'PLAYSTATION'],
    ['Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)', 'NINTENDO'],
    ['57e-2009-Pro Controller', 'NINTENDO'],
    ['Joy-Con (L/R)', 'NINTENDO'],
    ['USB Gamepad (Vendor: 0079 Product: 0011)', 'GENERIC'],
    ['', 'GENERIC'],
  ])('%s is %s', (id, family) => {
    expect(getGamepadFamily(id)).toBe(family);
  });

  it('takes the vendor over a name', () => {
    // A Sony pad whose name says "Xbox" (a remapper's) is still Sony's by its vendor
    expect(getGamepadFamily('Xbox remap (Vendor: 054c Product: 05c4)')).toBe('PLAYSTATION');
  });
});
