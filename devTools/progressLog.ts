/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';
import { ROOT } from './assetPipeline/sources';

/**
 * The verify commands' shared progress log (p601): every line they print also goes to
 * `.cache/verify/progress.log`, emptied when a run starts, so one command watches whichever run
 * is going, from any terminal: {@link PROGRESS_LOG_WATCH}. Another command keeps its own log
 * (`yarn sbp`'s `.cache/sbp/progress.log`, {@link setProgressLogFile}).
 */
export const PROGRESS_LOG = path.join(ROOT, '.cache/verify/progress.log');

/** The command that follows the progress log */
export const PROGRESS_LOG_WATCH = `tail -f ${path.relative(ROOT, PROGRESS_LOG)}`;

let logFile = PROGRESS_LOG;
let isStarted = false;
let isEnabled = true;
let isConsoleEnabled = true;

/** Writes this run's log to another file, before its first line; returns the command that
 * follows it */
export const setProgressLogFile = (file: string) => {
  logFile = file;
  return `tail -f ${path.relative(ROOT, file)}`;
};

/** Turns stdout off for this run: lines go to the log alone, errors to stderr too (`yarn sbp
 * --json` prints the report on stdout) */
export const setProgressLogConsole = (enabled: boolean) => {
  isConsoleEnabled = enabled;
};

/**
 * Turns the log off for this run, before its first line: a run that mustn't empty another run's
 * log (`yarn verify:baselines --docs`, which the Stop hook starts) only prints
 */
export const setProgressLogEnabled = (enabled: boolean) => {
  isEnabled = enabled;
};

/** Prints a line and appends it to the progress log (a convenience: a failed write is ignored) */
export const out = (line = '', isError = false) => {
  if (isError) console.error(line);
  else if (isConsoleEnabled) console.log(line);
  if (!isEnabled) return;
  try {
    if (!isStarted) {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fs.writeFileSync(logFile, '');
      isStarted = true;
    }
    fs.appendFileSync(logFile, `${line}\n`);
  } catch {
    // Watching is optional
  }
};
