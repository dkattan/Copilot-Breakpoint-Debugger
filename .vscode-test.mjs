import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/**/*.test.js',
  mocha: {
    ui: 'bdd',
  },
  launchArgs: ['--disable-extensions'],
  workspaceFolder: 'test-workspace',
});
