import * as assert from 'node:assert';
import * as vscode from 'vscode';
import {
  invokeStartDebuggerTool,
  stopAllDebugSessions,
} from './utils/startDebuggerToolTestUtils';

// Test that a very short configured timeout causes StartDebuggerTool to error
// when the breakpoint line is only executed after a longer delay.
describe('startDebuggerTool timeout behavior', () => {
  const settingKey = 'entryTimeoutSeconds';
  let originalTimeout: number | undefined;

  before(async () => {
    const config = vscode.workspace.getConfiguration('copilot-debugger');
    originalTimeout = config.get<number>(settingKey);
    await config.update(settingKey, 1, vscode.ConfigurationTarget.Workspace);
  });

  after(async () => {
    const config = vscode.workspace.getConfiguration('copilot-debugger');
    await config.update(
      settingKey,
      originalTimeout ?? 60,
      vscode.ConfigurationTarget.Workspace
    );
  });

  afterEach(async () => {
    await stopAllDebugSessions();
  });

  it('reports timeout when breakpoint not hit within configured seconds', async () => {
    const result = await invokeStartDebuggerTool({
      scriptRelativePath: 'test-workspace/b/test.js',
      configurationName: 'Run test.js with preLaunchTask',
      variableFilter: ['delayedValue'],
      breakpointLines: [6], // line with delayed assignment inside setTimeout callback
      workspaceFolder: 'test-workspace/b',
    });
    const { content } = result;
    assert.ok(content.length === 1, 'expected single output part');
    const text = (content[0] as vscode.LanguageModelTextPart).value as string;
    assert.match(
      text,
      /Timed out|timeout/i,
      'Expected timeout indication in tool output'
    );
  });
});
