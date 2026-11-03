/**
 * The game HUD pieces' checks (`game.ts`' demos): the input prompt, the kit preferences, the
 * resource bar, the cooldown and the crosshair.
 */
import type { UiDemoChecks } from '../_componentChecks';

/** The prompt row's glyphs (`game.ts`' `PROMPT_ID`): Jump's is the second prompt's */
const PROMPTS = '#hubDemoPromptRow';
const JUMP_GLYPH = `${PROMPTS} .aekInputPrompt:nth-of-type(2) .aekInputGlyph`;
const PREFERENCES = '#hubDemoPreferencesRoot';
const PREFERENCES_STATUS = '#hubDemoPreferencesStatus';
const HEALTH = '#hubDemoBarHealth';
const HEALTH_METER = `${HEALTH} .aekResourceBar__track`;
const DASH = '#hubDemoCooldownDash';
const COOLDOWN_STATUS = '#hubDemoCooldownStatus';
const CROSSHAIR = '#hubDemoCrosshairReticle';

/** The game HUD group's checks by their demo's key (`data-hub-demo`) */
export const GAME_CHECKS: Record<string, UiDemoChecks> = {
  inputPrompt: {
    keyboard: [
      {
        name: 'no keys; each prompt follows the prompt device, an image named by its input',
        steps: [
          { expectAttr: JUMP_GLYPH, name: 'aria-label', value: 'Space' },
          { click: 'PlayStation pad' },
          { expectAttr: JUMP_GLYPH, name: 'aria-label', value: 'Cross button' },
          { expectAttr: JUMP_GLYPH, name: 'data-family', value: 'playstation' },
          { click: 'Touch (the keyboard’s)' },
          { expectAttr: JUMP_GLYPH, name: 'aria-label', value: 'Space' },
        ],
      },
    ],
  },
  kitPreferences: {
    keyboard: [
      {
        name: 'no keys; each preference is written on the kit root and read back',
        steps: [
          { click: 'Light theme' },
          { expectAttr: PREFERENCES, name: 'data-aek-theme', value: 'light' },
          { click: 'Compact density' },
          { expectAttr: PREFERENCES, name: 'data-aek-density', value: 'compact' },
          {
            expectText: PREFERENCES_STATUS,
            text: 'Theme light, UI scale 1, reduced motion system, density compact',
          },
          { click: 'Back to the defaults' },
          { expectAttr: PREFERENCES, name: 'data-aek-theme', value: null },
          { expectAttr: PREFERENCES, name: 'data-aek-density', value: null },
        ],
      },
    ],
  },
  resourceBar: {
    keyboard: [
      {
        name: 'no keys; a meter whose value text says the value and the threshold’s word',
        steps: [
          { expectAttr: HEALTH_METER, name: 'role', value: 'meter' },
          { expectAttr: HEALTH_METER, name: 'aria-valuetext', value: '72 of 100' },
          { click: 'Low health' },
          { expectAttr: HEALTH_METER, name: 'aria-valuetext', value: '18 of 100, Low' },
          { expectAttr: HEALTH, name: 'data-state', value: 'danger' },
          { expectText: `${HEALTH} .aekResourceBar__status`, text: 'Low' },
          { click: 'Heal 40' },
          { expectAttr: HEALTH_METER, name: 'aria-valuetext', value: '58 of 100' },
          { expectAttr: HEALTH, name: 'data-change', value: 'heal' },
        ],
      },
    ],
  },
  cooldown: {
    keyboard: [
      {
        name: 'Enter uses the ability: aria-disabled and its description while it runs; again isn’t ready',
        steps: [
          { focusInBox: DASH },
          { press: 'Enter' },
          { expectText: COOLDOWN_STATUS, text: 'Dash used' },
          { expectAttr: DASH, name: 'aria-disabled', value: 'true' },
          { expectAttr: `${DASH} .aekCooldown`, name: 'data-state', value: 'running' },
          { expectAttr: `${DASH} .aekCooldown`, name: 'aria-hidden', value: 'true' },
          { press: 'Enter' },
          { expectText: COOLDOWN_STATUS, text: 'Dash isn’t ready' },
        ],
      },
      {
        name: 'a run ends by itself: the button as it was, and ready',
        steps: [
          { click: 'Start a 1 s cooldown on Dash' },
          { expectAttr: DASH, name: 'aria-disabled', value: 'true' },
          { expectAttr: DASH, name: 'aria-disabled', value: null },
          { expectText: COOLDOWN_STATUS, text: 'Dash ready' },
        ],
      },
    ],
  },
  crosshair: {
    keyboard: [
      {
        name: 'no keys; decoration for assistive tech; its state and a hit marker as attributes',
        steps: [
          { expectAttr: CROSSHAIR, name: 'aria-hidden', value: 'true' },
          { click: 'Over a target' },
          { expectAttr: CROSSHAIR, name: 'data-state', value: 'target' },
          { click: 'Shape: circle' },
          { expectAttr: CROSSHAIR, name: 'data-shape', value: 'circle' },
          { click: 'Critical' },
          { expectAttr: `${CROSSHAIR} .aekCrosshair__hit`, name: 'data-kind', value: 'critical' },
        ],
      },
    ],
  },
};
