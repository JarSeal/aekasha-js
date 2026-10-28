/**
 * The graphs' checks (`graphs.ts`' demos): no keys of their own, so a script each reads the ARIA
 * a screen reader gets, before and after the box's button (a live switch isn't run: its frames
 * would make the shots and the texts differ).
 */
import type { UiDemoChecks } from '../_componentChecks';

/** A graph demo's element by its id's name (`graphs.ts`' `GRAPH_ID`) */
const GRAPH = (name: string) => `#hubDemoGraph${name}`;
const TILE = (name: string, part: string) => `${GRAPH(name)} .aekStatTile__${part}`;
/** The frame time series' third series' summary line */
const RENDER_ITEM = `${GRAPH('StagesSeries')} .aekTimeSeries__item:nth-child(3)`;
/** The frame time series' top grid line's value: its range's end */
const SERIES_TOP_TICK = `${GRAPH('StagesSeries')} .aekTimeSeries__gridLine:last-child .aekTimeSeries__tick`;

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
  chart: {
    keyboard: [
      {
        name: 'the toggle: Enter shows the table, again hides it; the chart an image, its rows named',
        steps: [
          { expectAttr: `${GRAPH('StagesChart')} .aekChart__figure`, name: 'role', value: 'img' },
          {
            expectText: `${GRAPH('StagesChart')} .aekChart__table tbody tr:nth-child(2) th`,
            text: 'Gym',
          },
          { focusInBox: `${GRAPH('StagesChart')} .aekChart__toggle` },
          { press: 'Enter' },
          {
            expectAttr: `${GRAPH('StagesChart')} .aekChart__toggle`,
            name: 'aria-expanded',
            value: 'true',
          },
          { expectText: `${GRAPH('StagesChart')} .aekChart__toggle`, text: 'Hide the table' },
          { press: 'Enter' },
          {
            expectAttr: `${GRAPH('StagesChart')} .aekChart__toggle`,
            name: 'aria-expanded',
            value: 'false',
          },
        ],
      },
    ],
  },
  timeSeries: {
    keyboard: [
      {
        name: 'no keys; the plot hidden, the summary its text; a long frame grows the range',
        steps: [
          {
            expectAttr: `${GRAPH('StagesSeries')} .aekTimeSeries__plot`,
            name: 'aria-hidden',
            value: 'true',
          },
          { expectText: `${RENDER_ITEM} .aekTimeSeries__label`, text: 'Render' },
          { expectText: `${RENDER_ITEM} .aekTimeSeries__value`, text: '6.5 ms' },
          { expectText: `${RENDER_ITEM} .aekTimeSeries__range`, text: 'min 4.5, max 11.3' },
          { expectText: SERIES_TOP_TICK, text: '20' },
          { click: 'A long frame' },
          { expectText: SERIES_TOP_TICK, text: '50' },
          {
            expectAttr: `${GRAPH('DrawCallsSeries')} .aekTimeSeries__plot`,
            name: 'aria-hidden',
            value: 'true',
          },
          { expectCount: `${GRAPH('DrawCallsSeries')} .aekTimeSeries__gridLine`, count: 0 },
        ],
      },
    ],
  },
  graphMonitor: {
    keyboard: [
      {
        name: 'no keys; the value is the text, the graph hidden; the grid’s graph loaded',
        steps: [
          { expectText: `${GRAPH('FrameMonitor')} .aekMonitor__value`, text: '15.0' },
          {
            expectAttr: `${GRAPH('FrameMonitor')} .aekTimeSeries__plot`,
            name: 'aria-hidden',
            value: 'true',
          },
          {
            expectCount: '[data-hub-demo="graphMonitor"] .aekPropertyGrid .aekTimeSeries',
            count: 1,
          },
        ],
      },
    ],
  },
};
