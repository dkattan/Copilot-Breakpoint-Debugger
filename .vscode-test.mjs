// import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
// import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@vscode/test-cli';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Clear user data directory before tests to prevent cached workspace state
const userDataDir = resolve(__dirname, '.vscode-test/user-data');
if (existsSync(userDataDir)) {
  rmSync(userDataDir, { recursive: true, force: true });
}

export default defineConfig({
  files: 'out/test/**/*.test.js',
  version: 'stable', // Match the parent VS Code version
  mocha: {
    ui: 'bdd',
    timeout: 30000,
    parallel: false,
  },
  // Allow extensions to load; we install required ones below via the 'extensions' field.
  // Removed '--disable-extensions' so PowerShell can activate.
  launchArgs: [
    resolve(__dirname, 'test-workspace.code-workspace'),
    '--disable-extensions',
    // '--install-extension',
    // 'ms-vscode.powershell',
    // '--profile-temp',
  ],
  // Request automatic installation of required marketplace extensions for tests.
  // @vscode/test-cli will ensure these are present before running.
  extensions: ['ms-vscode.powershell'],
  coverage: {
    reporter: ['text', 'html', 'lcov'],
    exclude: ['**/test/**', '**/node_modules/**'],
  },
});
