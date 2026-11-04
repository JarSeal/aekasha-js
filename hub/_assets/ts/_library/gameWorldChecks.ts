/**
 * The game world pieces' checks (`gameWorld.ts`' demos): the world anchor layer, the compass and
 * the minimap frame.
 */
import type { UiDemoChecks } from '../_componentChecks';

const STAGE = '#hubDemoAnchorsStage';
const WAYPOINT = `${STAGE} .aekWorldAnchor:has(.hubDemoWaypoint)`;
const ANCHORS_STATUS = '#hubDemoAnchorsStatus';
const COMPASS = '#hubDemoCompassStrip';
const MINIMAP = '#hubDemoMinimapSlot .aekMinimapFrame';

/** The game world group's checks by their demo's key (`data-hub-demo`) */
export const GAME_WORLD_CHECKS: Record<string, UiDemoChecks> = {
  worldAnchors: {
    keyboard: [
      {
        name: 'no keys; the waypoint is clamped to the edge while off screen, shown when faced',
        steps: [
          { expectAttr: WAYPOINT, name: 'data-state', value: 'clamped' },
          { expectText: ANCHORS_STATUS, text: 'Facing 0°, the waypoint clamped' },
          { click: 'Turn to the beacon' },
          { expectAttr: WAYPOINT, name: 'data-state', value: 'shown' },
          {
            expectCount: `${STAGE} .aekWorldAnchor[data-state="hidden"]:has(.hubDemoNameplate)`,
            count: 4,
          },
        ],
      },
    ],
  },
  compass: {
    keyboard: [
      {
        name: 'no keys; the strip is decoration, the heading a hidden text; a marker out of view at an end',
        steps: [
          { expectText: `${COMPASS} .aekCompass__spoken`, text: 'Facing north' },
          { click: 'Face east' },
          { expectText: `${COMPASS} .aekCompass__spoken`, text: 'Facing east' },
          { click: 'Face the beacon' },
          { expectText: `${COMPASS} .aekCompass__spoken`, text: 'Facing north-west' },
        ],
      },
    ],
  },
  minimapFrame: {
    keyboard: [
      {
        name: 'a group named Map; its zoom buttons disabled at the limits; the heading a hidden text',
        steps: [
          { expectAttr: MINIMAP, name: 'role', value: 'group' },
          { expectAttr: MINIMAP, name: 'aria-label', value: 'Map' },
          { focusInBox: `${MINIMAP} .aekMinimapFrame__zoomButton` },
          { press: 'Enter' },
          { expectText: '#hubDemoMinimapStatus', text: 'Zoom 1.6' },
          {
            expectAttr: `${MINIMAP} .aekMinimapFrame__zoomButton`,
            name: 'aria-disabled',
            value: 'true',
          },
          { click: 'The player faces east' },
          { expectText: `${MINIMAP} .aekMinimapFrame__spoken`, text: 'Facing east' },
        ],
      },
    ],
  },
};
