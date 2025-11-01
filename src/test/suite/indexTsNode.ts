import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';
import * as fs from 'fs';

// Register ts-node so VS Code extension host can execute TypeScript test sources directly.
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    module: 'Node16',
    target: 'ES2022',
    sourceMap: true,
  },
});

function findRepoRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error('Could not locate repository root (package.json)');
    }
    dir = parent;
  }
}

export function run(): Promise<void> {
  const sentinel = (global as any).__TS_NODE_TEST_RUN__;
  if (sentinel) {
    console.log(
      '[ts-node-test] Skipping duplicate test run (sentinel detected)'
    );
    return Promise.resolve();
  }
  (global as any).__TS_NODE_TEST_RUN__ = true;
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: 60000,
  });

  // __dirname when compiled is out/test/suite; we want src/test for source TS files
  const repoRoot = findRepoRoot(__dirname);
  const testsRoot = path.join(repoRoot, 'src', 'test');

  return new Promise((c, e) => {
    glob('**/*.test.ts', { cwd: testsRoot })
      .then((files: string[]) => {
        if (files.length === 0) {
          console.warn(
            '[ts-node-test] No .test.ts files found under',
            testsRoot
          );
        }
        files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));
        try {
          mocha.run(failures => {
            if (failures > 0) {
              e(new Error(`${failures} tests failed.`));
            } else {
              c();
            }
          });
        } catch (err) {
          console.error(err);
          e(err);
        }
      })
      .catch(e);
  });
}
