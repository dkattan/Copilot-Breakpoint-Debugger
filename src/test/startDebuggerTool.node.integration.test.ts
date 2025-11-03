import {
  invokeStartDebuggerTool,
  assertStartDebuggerOutput,
} from './utils/startDebuggerToolTestUtils';

// Integration test: launches a Node.js debug session for test.js, sets a breakpoint,
// invokes StartDebuggerTool, and asserts we receive stopped-session debug info.
//
// This provides equivalent coverage to PowerShell tests and is reliable in CI environments.

suite('StartDebuggerTool Integration (Node.js)', () => {
  test('starts debugger and captures breakpoint debug info', async function () {
    this.timeout(5000); // allow time for activation + breakpoint

    const result = await invokeStartDebuggerTool({
      scriptRelativePath: 'test-workspace/test.js',
      timeoutSeconds: 60,
      variableFilter: ['randomValue', 'i'],
      breakpointLines: [1], // First line
    });

    const textOutput = result.textOutput;
    console.log('StartDebuggerTool Node.js output:\n', textOutput);
    assertStartDebuggerOutput(textOutput);
  });
});
