// The device capability check's CPU benchmark (p240 §5 step 4): main-thread mat4 multiplies on
// typed arrays, the ECS transforms' kind of work, after a JIT warm-up. Loaded with the benchmark
// (`DeviceBenchmark.ts`), never by a stored result's boot.

/** The matrices multiplied in a round: their arrays stay in the L1 cache, as a transform pass's
 * hot data would. */
const MATRIX_COUNT = 64;
/** The multiplies between two clock reads (the clock read costs more than a multiply). */
const OPS_PER_ROUND = MATRIX_COUNT;

/**
 * {@link runCpuBenchmark}'s options.
 * @internal
 */
export type CpuBenchmarkOpts = {
  /** How long to measure, ms. */
  durationMs: number;
  /** How long to run first, unmeasured, so the JIT has compiled the loop, ms. */
  warmUpMs: number;
  /** The clock, ms. Default `performance.now`. */
  now?: () => number;
};

/** Multiplies `a[i] × b[i]` into `out[i]` for every matrix (column-major, as three's). */
const multiplyRound = (a: Float32Array, b: Float32Array, out: Float32Array) => {
  for (let m = 0; m < MATRIX_COUNT * 16; m += 16) {
    for (let col = 0; col < 4; col++) {
      const b0 = b[m + col * 4];
      const b1 = b[m + col * 4 + 1];
      const b2 = b[m + col * 4 + 2];
      const b3 = b[m + col * 4 + 3];
      for (let row = 0; row < 4; row++) {
        out[m + col * 4 + row] =
          a[m + row] * b0 + a[m + 4 + row] * b1 + a[m + 8 + row] * b2 + a[m + 12 + row] * b3;
      }
    }
  }
};

/** A checksum of the products, kept where the JIT can't prove it unused, so it can't drop the
 * work. The inputs stay the same every round: a product fed back would shrink toward denormals,
 * which some CPUs run many times slower. */
let checksum = 0;

/** Runs rounds until `untilMs` on the clock; the multiplies done and the clock's last read. */
const runRoundsUntil = (
  untilMs: number,
  now: () => number,
  a: Float32Array,
  b: Float32Array,
  out: Float32Array
) => {
  let ops = 0;
  let time: number;
  do {
    multiplyRound(a, b, out);
    checksum += out[ops & 1023];
    ops += OPS_PER_ROUND;
    time = now();
  } while (time < untilMs);
  return { ops, endedAt: time };
};

/**
 * The checksum of every round so far (a test's proof the work ran).
 * @internal
 */
export const getCpuBenchmarkChecksum = () => checksum;

/**
 * The CPU benchmark: mat4 multiplies per ms on the main thread, blocking it for `warmUpMs` +
 * `durationMs`. A higher score is a faster core; one core only (the main thread is the one an
 * app's frame waits on).
 * @internal
 * @returns the score: matrix multiplies per ms
 */
export const runCpuBenchmark = ({
  durationMs,
  warmUpMs,
  now = () => performance.now(),
}: CpuBenchmarkOpts) => {
  const a = new Float32Array(MATRIX_COUNT * 16);
  const b = new Float32Array(MATRIX_COUNT * 16);
  const out = new Float32Array(MATRIX_COUNT * 16);
  for (let i = 0; i < a.length; i++) {
    a[i] = ((i * 7) % 13) / 13 - 0.5;
    b[i] = ((i * 5) % 11) / 11 - 0.5;
  }
  runRoundsUntil(now() + warmUpMs, now, a, b, out);
  const start = now();
  const { ops, endedAt } = runRoundsUntil(start + durationMs, now, a, b, out);
  const elapsed = endedAt - start;
  return elapsed > 0 ? Math.round(ops / elapsed) : 0;
};
