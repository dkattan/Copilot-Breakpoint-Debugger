import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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
  },
  launchArgs: [
    resolve(__dirname, 'test-workspace.code-workspace'),
    '--disable-extensions',
  ],
  coverage: {
    reporter: ['text', 'html', 'lcov'],
    exclude: ['**/test/**', '**/node_modules/**'],
  },
});
