import fs from 'node:fs';
import { defineConfig } from '@playwright/test';

const SYSTEM_CHROME_PATH =
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SYSTEM_EDGE_PATH =
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

function resolveBrowserExecutablePath(): string | undefined {
  if (fs.existsSync(SYSTEM_CHROME_PATH)) {
    return SYSTEM_CHROME_PATH;
  }
  if (fs.existsSync(SYSTEM_EDGE_PATH)) {
    return SYSTEM_EDGE_PATH;
  }
  return undefined;
}

const executablePath = resolveBrowserExecutablePath();

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.spec.ts',
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    headless: true,
    viewport: { width: 1280, height: 900 },
    actionTimeout: 15_000,
    trace: 'off',
    ...(executablePath
      ? {
          launchOptions: {
            executablePath,
          },
        }
      : {}),
  },
  webServer: {
    command: 'node node_modules/tsx/dist/cli.mjs tests/e2e/dev-mock-server.ts',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 45_000,
  },
});
