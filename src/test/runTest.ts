import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import process from 'node:process';
import {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
  runTests,
} from '@vscode/test-electron';

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

    // Decide which VS Code build channel to use for tests.
    // NEW DEFAULT: use 'insiders' locally for easier debugging parity with dev environment.
    // CI always uses stable for reproducibility.
    // Override locally by setting TEST_USE_STABLE=1.
    let channel: 'stable' | 'insiders';
    if (process.env.CI) {
      channel = 'stable';
    } else if (process.env.TEST_USE_STABLE === '1') {
      channel = 'stable';
    } else {
      channel = 'insiders';
    }
    console.log(`[test-runner] Downloading VS Code channel: ${channel}`);
    const vscodeExecutablePath = await downloadAndUnzipVSCode(channel);
    const [cliPath] =
      resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);

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
    if (enableDebug && channel === 'insiders') {
      console.log(
        '[test-runner] Running tests against Insiders build (default).'
      );
    } else if (enableDebug && channel === 'stable') {
      console.log(
        '[test-runner] Running tests against Stable build (TEST_USE_STABLE=1 or CI).'
      );
    }
    if (enableDebug) {
      console.log(
        '[test-runner] Enabling early extension host break (debug friendly test run)'
      );
    }

    const testWorkspaceFile = path.resolve(
      extensionDevelopmentPath,
      'test-workspace.code-workspace'
    );

    const launchArgs = [
      testWorkspaceFile,
      '--user-data-dir',
      userDataDir,
      '--disable-workspace-trust',
      '--disable-telemetry',
      '--disable-updates',
    ];
    // Opt-in early break for extension host so breakpoints in both extension & test sources bind deterministically.
    // Set TEST_EARLY_BREAK=1 or TEST_DEBUG=1 in environment to enable. (We don't always enable by default to keep CI fast.)
    if (
      enableDebug &&
      (process.env.TEST_EARLY_BREAK === '1' || process.env.TEST_DEBUG === '1')
    ) {
      launchArgs.unshift('--inspect-brk-extensions');
      console.log(
        '[test-runner] Added --inspect-brk-extensions for early breakpoint binding'
      );
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
