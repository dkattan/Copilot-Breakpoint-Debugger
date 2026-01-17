// Keep this script CJS so it runs the same way under all Node versions and npm script shells.
// Purpose: ensure VS Code test user-data is removed before running vscode-test.

const fs = require('node:fs');
const path = require('node:path');

const userDataDir = path.resolve(__dirname, '..', '.vscode-test', 'user-data');

try {
	fs.rmSync(userDataDir, { recursive: true, force: true });
} catch {
	// Ignore cleanup errors; tests should still run.
}
