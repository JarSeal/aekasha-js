/**
 * The graphs' checks (`graphs.ts`' demos): no keys of their own, so a script each reads the ARIA
 * a screen reader gets, before and after the box's button.
 */
import type { UiDemoChecks } from '../_componentChecks';

/** A graph demo's element by its id's name (`graphs.ts`' `GRAPH_ID`) */
const GRAPH = (name: string) => `#hubDemoGraph${name}`;
const TILE = (name: string, part: string) => `${GRAPH(name)} .aekStatTile__${part}`;

/** The graphs' checks by their demo's key (`data-hub-demo`) */
export const GRAPHS_CHECKS: Record<string, UiDemoChecks> = {
  sparkline: {
    keyboard: [
      {
        name: 'no keys; beside its figure it’s hidden, with a label it’s an image',
        steps: [
          { expectAttr: GRAPH('Triangles'), name: 'aria-hidden', value: 'true' },
          { expectAttr: GRAPH('Frames'), name: 'role', value: 'img' },
          {
            expectAttr: GRAPH('Frames'),
            name: 'aria-label',
            value: 'Frame time over the last 16 frames, 16 to 33 ms',
          },
          { expectCount: `${GRAPH('Frames')} .aekSparkline__dot[display="none"]`, count: 0 },
        ],
      },
    ],
  },
  donut: {
    keyboard: [
      {
        name: 'no keys; a meter with its value, parts an image whose label lists them',
        steps: [
          { expectAttr: GRAPH('Budget'), name: 'role', value: 'meter' },
          { expectAttr: GRAPH('Budget'), name: 'aria-valuenow', value: '62' },
          { click: 'Fill to 90 %' },
          { expectAttr: GRAPH('Budget'), name: 'aria-valuenow', value: '90' },
          { expectText: `${GRAPH('Budget')} .aekDonut__centre`, text: '90 %' },
          { expectAttr: GRAPH('Memory'), name: 'role', value: 'img' },
          {
            expectAttr: GRAPH('Memory'),
            name: 'aria-label',
            value: 'GPU memory: Textures 182 MB, Geometry 64 MB, Render targets 48 MB',
          },
        ],
      },
    ],
  },
  stackedBar: {
    keyboard: [
      {
        name: 'no keys; an image whose label gives each part, over the budget marked',
        steps: [
          {
            expectAttr: GRAPH('Stages'),
            name: 'aria-label',
            value:
              'Frame by stage: Physics 2.1 ms (18 %), Logic 1.4 ms (12 %), Render 6.8 ms (59 %), Post 1.2 ms (10 %)',
          },
          { expectAttr: GRAPH('MemoryBudget'), name: 'data-over', value: null },
          { click: 'Go over the budget' },
          { expectAttr: GRAPH('MemoryBudget'), name: 'data-over', value: '' },
          {
            expectAttr: GRAPH('MemoryBudget'),
            name: 'aria-label',
            value: 'GPU memory against its budget: Used 600 MB',
          },
        ],
      },
    ],
  },
  statTile: {
    keyboard: [
      {
        name: 'no keys; the change in words, its colour by which way is good',
        steps: [
          { expectText: TILE('FrameTime', 'value'), text: '16.1' },
          { expectText: `${TILE('FrameTime', 'delta')} .aekVisuallyHidden`, text: 'down 4.2 %' },
          { expectAttr: GRAPH('FrameTime'), name: 'data-tone', value: 'success' },
          { expectAttr: GRAPH('DrawCalls'), name: 'data-tone', value: null },
          { expectAttr: GRAPH('Fps'), name: 'data-tone', value: 'danger' },
          { expectText: TILE('MemoryTile', 'value'), text: '–' },
          { click: 'Next period' },
          { expectText: `${TILE('FrameTime', 'delta')} .aekVisuallyHidden`, text: 'up 8.1 %' },
          { expectAttr: GRAPH('FrameTime'), name: 'data-tone', value: 'danger' },
          { expectAttr: GRAPH('DrawCalls'), name: 'data-trend', value: 'flat' },
          { expectText: TILE('MemoryTile', 'value'), text: '318' },
        ],
      },
    ],
  },
};
