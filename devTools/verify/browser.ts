/**
 * The browser the verify commands drive (`yarn verify:scenes`, `yarn verify:embed`): a system
 * Chrome / Chromium / Edge when there is one (the run-aekasha-js skill driver's list), else
 * playwright-core's own build, on WebGPU or on WebGL2 through SwiftShader.
 */
import fs from 'fs';
import os from 'os';
import { chromium } from 'playwright-core';

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
    // Linux and WSL2 (a Windows Chrome under /mnt/c can't be driven from WSL2: the debugging
    // pipe doesn't cross the boundary)
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
