import { ECSSystemStage } from '../../kernel/loop/SystemStages';
import type { FeatureContext } from '../../kernel/init/Features';
import { getElapsedTime } from '../../kernel/loop/MainLoop';
import { lineTimeUniform } from './LinePulse';

/** Writes the one time value every pulsing line reads. Lines never refill or animate
 * anything else here: consumers own their own refill cadence. */
const lineTimeSystem = () => {
  lineTimeUniform.value = getElapsedTime();
};

/**
 * Installs the line time system on every world (the `lines()` feature's install,
 * LinesFeature.ts): a core plugin, on `MAIN`, which runs whenever the master loop plays — so
 * pulses keep going while only the app loop is paused.
 *
 * Lines belong to no world, yet this is the only per-frame hook: with several worlds it
 * runs once per world, which is harmless (the same monotonic value is written each time);
 * with none, pulses would stand still. InitEngine always creates the default world.
 * @internal
 */
export const installLineTimeSystem = (ctx: FeatureContext) => {
  ctx.registerCorePlugin((world) => {
    world.addSystem(ECSSystemStage.MAIN, 'lineTimeSystem', lineTimeSystem);
    return world;
  });
};
