import { describe, expect, it } from 'vitest';
import type { ProfileReport, SbpReportFile } from '../sbp/report';
import { REPORT_FORMAT_VERSION } from '../sbp/report';
import { formatHubKiB, resolveSbpValue } from './sbp';

const size = (gzip: number) => ({ bytes: gzip * 3, gzip });

const banner: ProfileReport = {
  profile: { id: 'banner', entry: 'src/app/profiles/banner/banner.embed.ts', scenes: ['banner'] },
  initial: {
    total: size(307823),
    files: { 'banner.embed.js': size(212), 'assets/banner.embed.js': size(305594) },
  },
  lazy: { total: size(770944), files: { 'assets/GLTFLoader.js': size(13851), 'a.wasm': size(1) } },
  groups: {
    three: {
      initial: { modules: 4, minified: 1, gzip: 623025 },
      lazy: { modules: 0, minified: 0, gzip: 0 },
    },
  },
  features: [],
  diff: null,
  budgets: [
    { kind: 'initial', key: 'initial', budget: 313 * 1024, size: 307823, status: 'within' },
  ],
};

const report: SbpReportFile = { formatVersion: REPORT_FORMAT_VERSION, profiles: { banner } };

describe('the Hub’s {{sbp:…}} values', () => {
  it('formats gzip bytes as KiB with one decimal', () => {
    expect(formatHubKiB(307823)).toBe('300.6 KiB');
  });

  it('reads each measure', () => {
    expect(resolveSbpValue('banner.initial', report)).toEqual({ value: '300.6 KiB' });
    expect(resolveSbpValue('banner.lazy', report)).toEqual({ value: '752.9 KiB' });
    expect(resolveSbpValue('banner.lazyFiles', report)).toEqual({ value: '2' });
    expect(resolveSbpValue('banner.chunk:banner.embed.js', report)).toEqual({
      value: '0.2 KiB',
    });
    expect(resolveSbpValue('banner.chunk:assets/GLTFLoader.js', report)).toEqual({
      value: '13.5 KiB',
    });
    expect(resolveSbpValue('banner.group:three', report)).toEqual({ value: '608.4 KiB' });
    expect(resolveSbpValue('banner.budget:initial', report)).toEqual({ value: '313.0 KiB' });
  });

  it('fails on a profile sbp.config.ts doesn’t have, a measure or a key', () => {
    expect(resolveSbpValue('nope.initial', report)).toHaveProperty('error');
    expect(resolveSbpValue('banner.size', report)).toHaveProperty('error');
    expect(resolveSbpValue('banner.initial:x', report)).toHaveProperty('error');
    expect(resolveSbpValue('banner.group', report)).toHaveProperty('error');
    expect(resolveSbpValue('banner.group:nope', report)).toHaveProperty('error');
    expect(resolveSbpValue('banner.budget:assets/x.js', report)).toHaveProperty('error');
    expect(resolveSbpValue('banner', report)).toHaveProperty('error');
  });

  it('tells a missing report or profile apart', () => {
    expect(resolveSbpValue('banner.initial', null)).toHaveProperty('missing');
    expect(resolveSbpValue('app.initial', report)).toHaveProperty('missing');
  });
});
