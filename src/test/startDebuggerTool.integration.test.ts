import {
  invokeStartDebuggerTool,
  assertStartDebuggerOutput,
} from './utils/startDebuggerToolTestUtils';

// Integration test: launches a PowerShell debug session for test.ps1, sets a breakpoint,
// invokes StartDebuggerTool, and asserts we receive stopped-session debug info.

suite('StartDebuggerTool Integration (PowerShell)', () => {
  test('starts debugger and captures breakpoint debug info', async function () {
    this.timeout(60000); // allow time for activation + breakpoint
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
