import { beforeEach, describe, expect, it, vi } from 'vitest';

// The fog runtime, localStorage, the tab and the undo history are this test's
const m = vi.hoisted(() => ({
  ls: {} as Record<string, unknown>,
  sceneId: 'sceneA' as string | null,
  sceneFogs: [] as Record<string, unknown>[],
  fog: null as Record<string, unknown> | null,
  updates: [] as unknown[],
  setFogs: [] as unknown[],
  records: [] as { type: string; payload: unknown; coalesceKey?: string }[],
  handlers: {} as Record<string, { undo: (p: unknown) => void; redo: (p: unknown) => void }>,
}));
vi.mock(import('../../../utils/LocalAndSessionStorage'), async (importOriginal) => ({
  ...(await importOriginal()),
  lsGetItem: (key: string, defaultValue: unknown) => structuredClone(m.ls[key] ?? defaultValue),
  lsSetItem: (key: string, value: unknown) => {
    m.ls[key] = structuredClone(value);
  },
  lsRemoveItem: (key: string) => {
    delete m.ls[key];
  },
}));
vi.mock(import('../Fog'), async (importOriginal) => ({
  ...(await importOriginal()),
  _getSceneFogs: () => ({ sceneId: m.sceneId, fogs: m.sceneFogs }) as never,
  getFog: () => m.fog as never,
  updateFog: (values: object) => {
    m.updates.push(values);
    m.fog = { ...m.fog, ...structuredClone(values) };
    return m.fog as never;
  },
  setFog: (fog: unknown) => {
    m.setFogs.push(fog);
    return null;
  },
}));
vi.mock(import('../../../debug/DebuggerGUI'), async (importOriginal) => ({
  ...(await importOriginal()),
  updateDebuggerTab: () => {},
}));
vi.mock(import('../../../debug/_dbg__UndoRedo'), () => ({
  _recordUndoRedoAction: (type: string, _label: string, payload: unknown) => {
    m.records.push({ type, payload });
  },
  _recordOrCoalesceUndoRedoAction: (
    type: string,
    _label: string,
    payload: unknown,
    coalesceKey: string
  ) => {
    m.records.push({ type, payload, coalesceKey });
  },
  _registerUndoRedoActionHandler: (type: string, handler: object) => {
    m.handlers[type] = handler as (typeof m.handlers)[string];
  },
}));

import { FOG_DEBUG_OVERRIDES_LS_KEY } from '../Fog';
import { resolveFogDef } from '../FogDefaults';
import {
  clearFogOverrides,
  getAllFogOverrides,
  selectSceneFog,
  setFogValue,
  setFogValues,
} from './_dbg__FogEdits';

const valley = resolveFogDef({ id: 'valley', mode: 'HEIGHT', height: { density: 0.03 } });

beforeEach(() => {
  m.ls = {};
  m.sceneId = 'sceneA';
  m.sceneFogs = [valley];
  m.fog = structuredClone(valley);
  m.updates = [];
  m.setFogs = [];
  m.records = [];
});

describe('the fog tab’s edits (p106 D8)', () => {
  it('renders a value through updateFog, keeps it as an override and records it to coalesce', () => {
    setFogValue('height.density', 'density', 0.05);
    expect(m.updates).toEqual([{ height: { density: 0.05 } }]);
    expect(getAllFogOverrides()).toEqual({ sceneA: { valley: { height: { density: 0.05 } } } });
    expect(m.records).toEqual([
      {
        type: 'fog.values',
        payload: {
          sceneId: 'sceneA',
          fogId: 'valley',
          prev: { height: { density: 0.03 } },
          next: { height: { density: 0.05 } },
        },
        coalesceKey: 'sceneA.valley.height.density',
      },
    ]);
  });

  it('keeps only what differs from the scene’s definition, and rounds the field’s float noise', () => {
    setFogValue('height.falloff', 'falloff', 0.30000000000000004);
    setFogValue('height.density', 'density', 0.05);
    setFogValue('height.density', 'density', 0.03);
    expect(getAllFogOverrides()).toEqual({ sceneA: { valley: { height: { falloff: 0.3 } } } });
    setFogValue('height.falloff', 'falloff', 0.1);
    expect(m.ls).toEqual({});
  });

  it('records nothing for a value that doesn’t change', () => {
    setFogValue('mode', 'mode', 'HEIGHT');
    expect(m.records).toEqual([]);
  });

  it('shows a fog made in code’s edits without keeping them', () => {
    m.fog = structuredClone({ ...valley, id: 'smoke' });
    setFogValue('exp2.density', 'density', 0.04);
    expect(m.updates).toEqual([{ exp2: { density: 0.04 } }]);
    expect(m.ls).toEqual({});
    expect(m.records).toHaveLength(1);
  });

  it('records several values as one step, and undoes and redoes them', () => {
    setFogValues(
      'colour source',
      { colorSource: 'SKY', color: '#b4c0cc' },
      { colorSource: 'MANUAL', color: '#8090a0' }
    );
    expect(getAllFogOverrides()).toEqual({
      sceneA: { valley: { colorSource: 'MANUAL', color: '#8090a0' } },
    });
    const { payload } = m.records[0];
    m.handlers['fog.values'].undo(payload);
    expect(m.ls).toEqual({});
    expect(m.fog).toMatchObject({ colorSource: 'SKY', color: '#b4c0cc' });
    m.handlers['fog.values'].redo(payload);
    expect(m.fog).toMatchObject({ colorSource: 'MANUAL', color: '#8090a0' });
  });

  it('leaves another scene’s undo until that scene is current', () => {
    setFogValue('height.density', 'density', 0.05);
    const { payload } = m.records[0];
    m.sceneId = 'sceneB';
    m.updates = [];
    m.handlers['fog.values'].undo(payload);
    expect(m.updates).toEqual([]);
    expect(getAllFogOverrides().sceneA).toBeDefined();
  });

  it('selects another fog as an undo step', () => {
    selectSceneFog(null);
    expect(m.setFogs).toEqual([null]);
    expect(m.records[0]).toEqual({
      type: 'fog.select',
      payload: { sceneId: 'sceneA', prev: 'valley', next: null },
    });
    m.handlers['fog.select'].undo(m.records[0].payload);
    expect(m.setFogs).toEqual([null, 'valley']);
  });

  it('clears the scenes’ overrides, showing the fog from its definition again', () => {
    setFogValue('height.density', 'density', 0.05);
    const all = getAllFogOverrides();
    m.ls[FOG_DEBUG_OVERRIDES_LS_KEY] = { ...all, sceneB: { valley: { mode: 'EXP2' } } };
    clearFogOverrides(['sceneA']);
    expect(getAllFogOverrides()).toEqual({ sceneB: { valley: { mode: 'EXP2' } } });
    expect(m.setFogs).toEqual(['valley']);
  });
});
