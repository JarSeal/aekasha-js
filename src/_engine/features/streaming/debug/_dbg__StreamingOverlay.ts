// The Streaming tab's overlay (docs/plans/p353_macro-streaming-grid.md §7): the tracked cells'
// outlines from above, at a set height, coloured by state, and a cross at the focus. A line has one
// colour, so each state has its own line, refilled every frame while the overlay is on (LATE_MAIN,
// after the frame's decision and pump). Default world only; drawn with the lines() feature, off
// with one log line without it.
import { markDebugHelper } from '../../../debug/Profiler';
import { ECSWorld, getECSWorld } from '../../../kernel/ecs/ECS';
import { ECSSystemStage } from '../../../kernel/loop/SystemStages';
import type { LineObject } from '../../lines/LineObject';
import { createLines, isLinesInstalledFor } from '../../lines/Lines';
import type { LineWriter } from '../../lines/LineWriter';
import { getStreamingRuntime } from '../Streaming';
import type { StreamingCell } from '../StreamingCells';
import { StreamingLevel } from '../StreamingRings';

/** What a line draws: a state's cells, or the focus */
type OverlayLine = 'RESIDENT' | 'NEARBY' | 'QUEUED' | 'LOADING' | 'UNLOADING' | 'FOCUS';

/** Each line's colour: loaded green / yellow (the LOD overlay's level 0 and 1), queued grey,
 * loading blue, unloading red, the focus white. */
export const STREAMING_OVERLAY_COLORS: Record<OverlayLine, number> = {
  RESIDENT: 0x30c040,
  NEARBY: 0xe0c020,
  QUEUED: 0x808080,
  LOADING: 0x4080f0,
  UNLOADING: 0xd03020,
  FOCUS: 0xffffff,
};

const LINE_ORDER: readonly OverlayLine[] = [
  'RESIDENT',
  'NEARBY',
  'QUEUED',
  'LOADING',
  'UNLOADING',
  'FOCUS',
];

/** Cells per line at most (4 segments each). Past it the FIXED line drops the rest, with its own
 * warning: a far ring of 15 is 961 cells. */
const MAX_CELLS_PER_LINE = 1024;
/** Each outline is inset by this share of the cell, so two cells' edges don't draw over each other */
const INSET = 0.03;

const lines: LineObject[] = [];
const writers: LineWriter[] = [];
/** Segments written into each line this frame: an empty line is hidden (a draw of no vertices) */
const counts: number[] = [];
let isEnabled = false;
let isSystemRegistered = false;
let height = 0.5;

const createOverlayLine = (name: OverlayLine) => {
  const line = createLines({
    id: `STREAMING_DEBUG_OVERLAY_${name}`,
    // Segments: 4 per cell, the focus' cross 2
    capacity: name === 'FOCUS' ? 2 : MAX_CELLS_PER_LINE * 4,
    growth: 'FIXED',
    color: STREAMING_OVERLAY_COLORS[name],
    backend: 'THIN',
    // Created once and outlives scenes
    persistent: true,
  });
  markDebugHelper(line.object3D);
  // Shown by the system once it has written something (an empty line would draw no vertices)
  line.setVisible(false);
  return line;
};

const getCellLine = (cell: StreamingCell): number => {
  switch (cell.phase) {
    case 'LOADING':
      return 3;
    case 'UNLOADING':
      return 4;
    case 'UNLOADED':
      return 2;
    default:
      return cell.level === StreamingLevel.RESIDENT ? 0 : 1;
  }
};

const writeCell = (writer: LineWriter, cell: StreamingCell, cellSize: number, y: number) => {
  const inset = cellSize * INSET;
  const x0 = cell.cx * cellSize + inset;
  const z0 = cell.cz * cellSize + inset;
  const x1 = (cell.cx + 1) * cellSize - inset;
  const z1 = (cell.cz + 1) * cellSize - inset;
  writer.segment(x0, y, z0, x1, y, z0);
  writer.segment(x1, y, z0, x1, y, z1);
  writer.segment(x1, y, z1, x0, y, z1);
  writer.segment(x0, y, z1, x0, y, z0);
};

const streamingOverlaySystem = (world: ECSWorld) => {
  if (!isEnabled || world !== getECSWorld()) return;
  for (let i = 0; i < lines.length; i++) {
    writers[i] = lines[i].beginWrite();
    counts[i] = 0;
  }
  const rt = getStreamingRuntime();
  if (rt) {
    const { cellSize } = rt.settings;
    for (const cell of rt.cells.values()) {
      const line = getCellLine(cell);
      writeCell(writers[line], cell, cellSize, height);
      counts[line] += 4;
    }
    if (!Number.isNaN(rt.focusX)) {
      const r = cellSize * 0.1;
      const focus = writers[5];
      focus.segment(rt.focusX - r, height, rt.focusZ, rt.focusX + r, height, rt.focusZ);
      focus.segment(rt.focusX, height, rt.focusZ - r, rt.focusX, height, rt.focusZ + r);
      counts[5] = 2;
    }
  }
  for (let i = 0; i < lines.length; i++) {
    lines[i].endWrite();
    lines[i].setVisible(counts[i] > 0);
  }
};

/** Whether the overlay is on. */
export const isStreamingOverlayEnabled = () => isEnabled;

/** The overlay's height above y = 0, in metres. */
export const getStreamingOverlayHeight = () => height;

/** Sets the overlay's height above y = 0, in metres (the ground of a flat world). */
export const setStreamingOverlayHeight = (y: number) => {
  height = y;
};

/** Turns the overlay on or off. Its lines and system are made on the first enable; without the
 * lines() feature it stays off, with one log line. */
export const setStreamingOverlayEnabled = (enabled: boolean) => {
  if (enabled && !isLinesInstalledFor('streaming cells overlay')) return;
  isEnabled = enabled;
  if (enabled && !lines.length) {
    for (const name of LINE_ORDER) lines.push(createOverlayLine(name));
  }
  // Shown by the system once it has written something; hidden at once when turned off
  if (!enabled) for (let i = 0; i < lines.length; i++) lines[i].setVisible(false);
  if (enabled && !isSystemRegistered) {
    isSystemRegistered = true;
    ECSWorld.registerPlugin((w) => {
      w.addSystem(ECSSystemStage.LATE_MAIN, 'streamingOverlaySystem', streamingOverlaySystem);
    });
  }
};
