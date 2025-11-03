import {
  invokeStartDebuggerTool,
  assertStartDebuggerOutput,
} from './utils/startDebuggerToolTestUtils';

// Integration test: launches a PowerShell debug session for test.ps1, sets a breakpoint,
// invokes StartDebuggerTool, and asserts we receive stopped-session debug info.
//
// Note: This test requires PowerShell runtime and is skipped in CI environments.
// For CI, we rely on Node.js tests which provide equivalent coverage of the
// debug adapter protocol functionality.

suite('StartDebuggerTool Integration (PowerShell)', () => {
  test('starts debugger and captures breakpoint debug info', async function () {
    // Skip PowerShell tests in CI - they require PowerShell runtime which may not be available
    // Node.js tests provide equivalent coverage for the debug adapter protocol functionality
    if (process.env.CI) {
      console.log(
        'Skipping PowerShell integration test in CI (use Node.js tests for coverage)'
      );
      this.skip();
      return;
    }

    this.timeout(5000); // allow time for activation + breakpoint
    let textOutput: string;
    try {
      const result = await invokeStartDebuggerTool({
        scriptRelativePath: 'test-workspace/test.ps1',
        timeoutSeconds: 60,
        variableFilter: ['PWD', 'HOME'],
        breakpointLines: [1],
      });
      textOutput = result.textOutput;
    } catch (err) {
      if ((err as Error).message === 'pwsh-missing') {
        this.skip();
        return;
      }
      throw err;
    }
    console.log('StartDebuggerTool output:\n', textOutput);
    assertStartDebuggerOutput(textOutput);
  });
});
