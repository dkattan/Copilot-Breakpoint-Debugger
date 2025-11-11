import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@vscode/test-cli';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  files: 'out/test/**/*.test.js',
  mocha: {
    ui: 'bdd',
  },
  launchArgs: [resolve(__dirname, 'test-workspace.code-workspace')],
  coverage: {
    reporter: ['text', 'html', 'lcov'],
    exclude: ['**/test/**', '**/node_modules/**'],
  },
});
