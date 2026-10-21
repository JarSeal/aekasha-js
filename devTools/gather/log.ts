/* eslint-disable no-console -- the gather's own log */
import type z from 'zod';
import { expandUnionIssues } from './gatheredJson';

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';
const PREFIX = '[Scene Gatherer]';

/** The gather's log. An error fails the gather: `hasError` says whether one was logged. */
export type GatherLog = {
  /** Logs `✗ [Scene Gatherer] <message>` and fails the gather */
  error: (message: string) => void;
  /** Logs lines under the last error, as they are */
  details: (...lines: string[]) => void;
  /** Logs `⚠ [Scene Gatherer] <message>`; the gather goes on */
  warn: (message: string) => void;
  /** Logs `✓ [Scene Gatherer] <message>` */
  done: (message: string) => void;
  /** A schema's issues, one line each at its path, and fails the gather */
  validationError: (message: string, issues: z.ZodError['issues']) => void;
  readonly hasError: boolean;
};

/** A new log, without errors */
export const createGatherLog = (): GatherLog => {
  let hasError = false;
  return {
    error: (message) => {
      console.error(`${RED}✗ ${PREFIX} ${message}${RESET}`);
      hasError = true;
    },
    details: (...lines) => {
      for (const line of lines) console.error(line);
    },
    warn: (message) => console.warn(`${YELLOW}⚠ ${PREFIX} ${message}${RESET}`),
    done: (message) => console.log(`${GREEN}✓ ${PREFIX} ${message}${RESET}`),
    validationError: (message, issues) => {
      const details = expandUnionIssues(issues)
        .map((issue) => ` └─ [${issue.path.join('.')}]: ${issue.message}`)
        .join('\n');
      console.error(`${RED}✗ ${PREFIX} ${message}:\n${details}${RESET}`);
      hasError = true;
    },
    get hasError() {
      return hasError;
    },
  };
};
