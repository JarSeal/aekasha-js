/**
 * The browser the verify commands drive (`yarn verify:scenes`, `yarn verify:embed`, `yarn
 * verify:ui`): a system Chrome / Chromium / Edge when there is one (the run-aekasha-js skill
 * driver's list), else playwright-core's own build, on WebGPU or on WebGL2 through SwiftShader.
 * On WSL2, the scene runner and the embed check drive the Windows Chrome instead
 * (`launchVerifyChromiumAsync`): headless WebGPU on the real GPU, where WSL2's own Chromium has
 * only SwiftShader.
 */
import { type ChildProcess, spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { type Browser, chromium } from 'playwright-core';

/** WSL2: headless WebGPU can't render there, so the page renders on WebGL2 (SwiftShader) */
export const isWSL = () => os.release().toLowerCase().includes('microsoft');

/** A system Chrome / Chromium / Edge; undefined when there's none */
export const findBrowserExecutable = () => {
  const candidates: string[] = [];
  const platform = os.platform();
  if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    );
  } else if (platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    );
  } else {
    // Linux and WSL2 (a Windows Chrome under /mnt/c can't be launched through Playwright's pipe
    // from WSL2; `launchWindowsChromeAsync` connects to its debugging port instead)
    candidates.push(
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium'
    );
  }
  return candidates.find((p) => fs.existsSync(p));
};

/**
 * Launches Chromium on WebGPU, or on WebGL2 through SwiftShader.
 * @throws when it doesn't launch, with how to get one when no system browser was found
 */
export const launchChromium = async (opts: { useWebGL: boolean; headed: boolean }) => {
  const executablePath = findBrowserExecutable();
  const args = opts.useWebGL
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
    : ['--enable-unsafe-webgpu', '--enable-features=Vulkan'];
  try {
    return await chromium.launch({
      ...(executablePath ? { executablePath } : {}),
      headless: !opts.headed,
      args,
    });
  } catch (err) {
    const hint = executablePath
      ? ''
      : '\nNo system Chrome found: install one, or run `npx playwright-core install chromium` once.';
    throw new Error(`The browser didn't launch: ${(err as Error).message}${hint}`);
  }
};

/** A launched verify browser: `closeAsync` (not `browser.close()`) also ends a Windows Chrome */
export type VerifyChromium = {
  browser: Browser;
  /** True when the page renders on WebGL2 through SwiftShader */
  useWebGL: boolean;
  /** What renders, for the run's first lines */
  label: string;
  closeAsync: () => Promise<void>;
};

// --- Windows Chrome from WSL2 ---

/** The profiles' folder in the Windows `%TEMP%`, one profile per run */
const PROFILES_DIR = 'aekasha-verify-chrome';
/** A profile left by a run that didn't end (a killed process) is removed after this */
const STALE_PROFILE_MS = 24 * 60 * 60 * 1000;
const START_TIMEOUT_MS = 20_000;
const PROBE_TIMEOUT_MS = 10_000;

/** The Windows environment (`cmd.exe /c set`), keys upper-cased; null without interop */
const readWindowsEnv = () => {
  // A Windows working directory: cmd.exe warns about a UNC path otherwise
  const r = spawnSync('cmd.exe', ['/d', '/c', 'set'], {
    cwd: '/mnt/c',
    encoding: 'utf8',
    timeout: 10_000,
  });
  if (r.status !== 0 || !r.stdout) return null;
  const env: Record<string, string> = {};
  for (const line of r.stdout.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) env[line.slice(0, i).toUpperCase()] = line.slice(i + 1);
  }
  return env;
};

/** A Windows path as WSL2 sees it; null when `wslpath` can't convert it */
const toWslPath = (winPath: string) =>
  spawnSync('wslpath', ['-u', winPath], { encoding: 'utf8' }).stdout?.trim() || null;

/** The Windows Chrome or Edge, as a WSL2 path; undefined when there's none */
const findWindowsChrome = (env: Record<string, string>) => {
  const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA];
  const candidates = roots.flatMap((root) =>
    root ? [`${root}\\Google\\Chrome\\Application\\chrome.exe`] : []
  );
  if (env['PROGRAMFILES(X86)']) {
    candidates.push(`${env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`);
  }
  return candidates.map(toWslPath).find((p): p is string => !!p && fs.existsSync(p));
};

/** Removes the profiles of runs that didn't end, best effort */
const removeStaleProfiles = (wslDir: string) => {
  let names: string[];
  try {
    names = fs.readdirSync(wslDir);
  } catch {
    return;
  }
  for (const name of names) {
    const dir = path.join(wslDir, name);
    try {
      if (Date.now() - fs.statSync(dir).mtimeMs > STALE_PROFILE_MS) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      // Still held by a Chrome, or gone: the next run tries again
    }
  }
};

/** The port Chrome wrote to `DevToolsActivePort` (it picks a free one for port 0) */
const waitForDebuggingPortAsync = async (wslProfile: string, child: ChildProcess) => {
  const file = path.join(wslProfile, 'DevToolsActivePort');
  const until = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`it exited (${child.exitCode})`);
    try {
      const port = Number(fs.readFileSync(file, 'utf8').split('\n')[0]);
      if (port > 0) return port;
    } catch {
      // Not written yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`no debugging port in ${START_TIMEOUT_MS / 1000} s`);
};

/** Resolves when the process exits, or after `ms` */
const waitForExitAsync = (child: ChildProcess, ms: number) =>
  new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(resolve, ms);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });

/** What `readAdapterAsync` reads of `navigator.gpu` (devTools has no WebGPU types) */
type PageGPU = {
  requestAdapter: () => Promise<{
    info: { vendor: string; architecture: string; isFallbackAdapter?: boolean };
  } | null>;
};

/** The WebGPU adapter a page gets, for the label; on Chrome's own `localhost` page (secure) */
const readAdapterAsync = async (browser: Browser, port: number) => {
  const page = await browser.newPage();
  try {
    await page.goto(`http://localhost:${port}/json/version`);
    return await page.evaluate(async () => {
      const gpu = (navigator as Navigator & { gpu?: PageGPU }).gpu;
      if (!gpu) return 'no WebGPU';
      const adapter = await gpu.requestAdapter();
      if (!adapter) return 'no WebGPU adapter';
      const { vendor, architecture } = adapter.info;
      const name = [vendor, architecture].filter(Boolean).join(' ') || 'unknown GPU';
      return adapter.info.isFallbackAdapter ? `${name}, a fallback adapter` : name;
    });
  } finally {
    await page.close();
  }
};

/**
 * Starts the Windows Chrome (or Edge) from WSL2 on a fresh profile in `%TEMP%`, with a debugging
 * port, and connects to it over CDP: its page renders WebGPU on the machine's GPU.
 * @param opts.probeUrl a page of the run's server, loaded once: WSL2's `localhost` must reach
 *   Windows (`networkingMode=mirrored`, or NAT's localhost forwarding)
 * @throws when there's no Windows Chrome, it doesn't start, or it can't reach `probeUrl`
 * @remarks A process exit that skips `closeAsync` still ends the Chrome (`taskkill`), but a
 * killed process leaves it running: the next run removes its profile once it's a day old.
 */
const launchWindowsChromeAsync = async (opts: {
  headed: boolean;
  probeUrl?: string;
}): Promise<VerifyChromium> => {
  const env = readWindowsEnv();
  if (!env?.TEMP) throw new Error('no Windows environment (is WSL interop off?)');
  const exe = findWindowsChrome(env);
  if (!exe) throw new Error('no Chrome or Edge installed on Windows');
  const winProfiles = `${env.TEMP}\\${PROFILES_DIR}`;
  const wslTemp = toWslPath(env.TEMP);
  if (!wslTemp) throw new Error(`can't reach ${env.TEMP} from WSL2`);
  const wslProfiles = path.join(wslTemp, PROFILES_DIR);
  removeStaleProfiles(wslProfiles);
  const profileName = `${Date.now()}-${process.pid}`;
  const wslProfile = path.join(wslProfiles, profileName);
  fs.mkdirSync(wslProfile, { recursive: true });

  const child = spawn(
    exe,
    [
      `--user-data-dir=${winProfiles}\\${profileName}`,
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      '--enable-unsafe-webgpu',
      ...(opts.headed ? [] : ['--headless=new']),
      'about:blank',
    ],
    { cwd: '/mnt/c', stdio: 'ignore' }
  );
  child.on('error', () => undefined);
  let browser: Browser | null = null;
  let pid = 0;
  let isClosed = false;
  // A process.exit() (a failed run) skips closeAsync: end the Chrome on the way out
  const killSync = () => {
    if (isClosed) return;
    if (pid) {
      spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        cwd: '/mnt/c',
        stdio: 'ignore',
      });
    }
    child.kill();
  };
  process.on('exit', killSync);
  // One close for every caller: a Ctrl-C closes while the run's own `finally` may close too
  let closing: Promise<void> | null = null;
  const closeAsync = () => (closing ??= closeOnceAsync());
  const closeOnceAsync = async () => {
    if (browser) {
      const session = await browser.newBrowserCDPSession().catch(() => null);
      await session?.send('Browser.close').catch(() => undefined);
    }
    await waitForExitAsync(child, 5000);
    killSync();
    isClosed = true;
    process.off('exit', killSync);
    await fs.promises.rm(wslProfile, { recursive: true, force: true }).catch(() => undefined);
  };

  try {
    const port = await waitForDebuggingPortAsync(wslProfile, child);
    browser = await chromium.connectOverCDP(`http://localhost:${port}`);
    const session = await browser.newBrowserCDPSession();
    const info = (await session.send('SystemInfo.getProcessInfo').catch(() => null)) as {
      processInfo: { type: string; id: number }[];
    } | null;
    pid = info?.processInfo.find((p) => p.type === 'browser')?.id ?? 0;
    await session.detach();
    const adapter = await readAdapterAsync(browser, port);
    if (opts.probeUrl) {
      const page = await browser.newPage();
      try {
        await page.goto(opts.probeUrl, { waitUntil: 'commit', timeout: PROBE_TIMEOUT_MS });
      } catch (err) {
        throw new Error(
          `it can't load ${opts.probeUrl} (${(err as Error).message.split('\n')[0]}): ` +
            'set networkingMode=mirrored in the Windows %USERPROFILE%\\.wslconfig'
        );
      } finally {
        await page.close();
      }
    }
    return {
      browser,
      useWebGL: false,
      label: `WebGPU (Windows ${path.basename(exe, '.exe')} ${browser.version()}, ${adapter})`,
      closeAsync,
    };
  } catch (err) {
    await closeAsync();
    throw err;
  }
};

/**
 * The browser of the scene runner and the embed check: on WSL2 the Windows Chrome on WebGPU
 * (unless `webgl` or `AEK_VERIFY_WINDOWS_CHROME=false`), falling back to WSL2's own Chromium on
 * SwiftShader with a note when it doesn't start; elsewhere `launchChromium`.
 * @param opts.webgl WebGL2 through SwiftShader, everywhere
 * @param opts.probeUrl a page of the run's server the Windows Chrome must load
 * @param opts.onNote a line for the run's output
 * @throws when no browser launches
 */
export const launchVerifyChromiumAsync = async (opts: {
  webgl: boolean;
  headed: boolean;
  probeUrl?: string;
  onNote: (note: string) => void;
}): Promise<VerifyChromium> => {
  const onWSL = isWSL();
  if (onWSL && !opts.webgl && process.env.AEK_VERIFY_WINDOWS_CHROME !== 'false') {
    try {
      return await launchWindowsChromeAsync(opts);
    } catch (err) {
      opts.onNote(
        `The Windows Chrome didn't start (${(err as Error).message}): WSL2's Chromium instead`
      );
    }
  }
  const useWebGL = opts.webgl || (onWSL && !opts.headed);
  const browser = await launchChromium({ useWebGL, headed: opts.headed });
  return {
    browser,
    useWebGL,
    label: useWebGL ? `WebGL2 (SwiftShader${opts.webgl ? '' : ', WSL2'})` : 'WebGPU',
    closeAsync: () => browser.close(),
  };
};
