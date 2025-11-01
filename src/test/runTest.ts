import * as path from 'path';
import { runTests, downloadAndUnzipVSCode } from '@vscode/test-electron';
import * as cp from 'child_process';
import * as fs from 'fs';

function findRepoRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error('Repository root (package.json) not found');
    }
    dir = parent;
  }
}

async function main() {
  try {
    // Resolve extension (repo) root independent of compiled vs source path depth
    const extensionDevelopmentPath = findRepoRoot(__dirname);

    // Decide test entrypoint: default compiled JS index, optional ts-node direct TS loader for breakpoint friendliness.
    const useTsNode = process.env.TEST_TS_NODE === '1' && !process.env.CI;
    const extensionTestsPath = useTsNode
      ? path.resolve(extensionDevelopmentPath, 'out/test/suite/indexTsNode.js')
      : path.resolve(__dirname, './suite/index');
    if (useTsNode) {
      console.log(
        '[test-runner] Using ts-node bootstrap for direct TypeScript test execution'
      );
    }

    // Prepare persistent test data dirs
    const testDataRoot = path.resolve(extensionDevelopmentPath, '.vscode-test');
    const userDataDir = path.join(testDataRoot, 'user-data');
    const extensionsDir = path.join(testDataRoot, 'extensions');
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.mkdirSync(extensionsDir, { recursive: true });

    // Download VS Code and resolve CLI path
    const vscodeExecutablePath = await downloadAndUnzipVSCode('stable');
    // Derive CLI path (macOS layout); extend for other OS as needed
    let cliPath: string;
    if (process.platform === 'darwin') {
      cliPath = path.join(
        vscodeExecutablePath,
        'Visual Studio Code.app',
        'Contents',
        'Resources',
        'app',
        'bin',
        'code'
      );
    } else if (process.platform === 'win32') {
      cliPath = path.join(vscodeExecutablePath, 'bin', 'code.cmd');
    } else {
      // linux
      cliPath = path.join(vscodeExecutablePath, 'bin', 'code');
    }

    const requiredExtensions = [
      'ms-vscode.PowerShell',
      'mcu-debug.debug-tracker-vscode',
    ];
    for (const ext of requiredExtensions) {
      const already =
        fs.existsSync(extensionsDir) &&
        fs
          .readdirSync(extensionsDir)
          .some(f => f.toLowerCase().includes(ext.split('.')[1].toLowerCase()));
      if (already) {
        console.log(`Extension ${ext} already installed.`);
        continue;
      }
      console.log(`Installing extension ${ext} for integration tests...`);
      console.log(`Using CLI path: ${cliPath}`);
      console.log(`Extensions dir: ${extensionsDir}`);

      // Check if CLI exists and is executable
      if (!fs.existsSync(cliPath)) {
        console.warn(`CLI path does not exist: ${cliPath}`);
        console.log(
          `Skipping extension installation, tests may fail if extensions not present`
        );
        continue;
      }

      const res = cp.spawnSync(
        cliPath,
        [
          '--user-data-dir',
          userDataDir,
          '--extensions-dir',
          extensionsDir,
          '--install-extension',
          ext,
        ],
        {
          encoding: 'utf-8',
          stdio: 'inherit',
          shell: process.platform === 'win32',
        }
      );
      if (res.status !== 0) {
        throw new Error(`Failed to install ${ext}, exit code ${res.status}`);
      }
    }

    // Always enable an early break in the extension host for local test runs (unless CI) so breakpoints in
    // TypeScript test sources can bind when you launch `npm test` from a JavaScript Debug Terminal.
    // This avoids needing a special script, port knowledge, or manual attach sequence.
    const enableDebug = !process.env.CI; // allow CI to run without inspector
    if (enableDebug) {
      console.log(
        '[test-runner] Enabling early extension host break (debug friendly test run)'
      );
    }

    const launchArgs = [
      '--user-data-dir',
      userDataDir,
      '--disable-workspace-trust',
      '--disable-telemetry',
      '--disable-updates',
    ];

    // When debugging, VS Code test harness respects --inspect-brk-extensionHost (legacy) or --inspect-brk-extensions
    // For current versions use --inspect-brk-extensions to pause early so breakpoints can be set before tests load.
    if (enableDebug) {
      // Prefer modern flag for early extension host pause
      launchArgs.unshift('--inspect-brk-extensions');
    }

    console.log('[test-runner] Launch args:', launchArgs.join(' '));
    console.log('[test-runner] extensionTestsPath:', extensionTestsPath);

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs,
    });
  } catch (err) {
    console.error('Failed to run tests');
    if (err instanceof Error) {
      console.error(err.message);
      console.error(err.stack);
    }
    process.exit(1);
  }
}

void main();
