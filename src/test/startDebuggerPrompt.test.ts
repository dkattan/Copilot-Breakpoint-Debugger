import * as assert from 'node:assert';
import * as vscode from 'vscode';
import {
  invokeStartDebuggerTool,
  stopAllDebugSessions,
} from './utils/startDebuggerToolTestUtils';

describe('startDebuggerTool concise text output', function () {
  this.timeout(60000);

  afterEach(async () => {
    await stopAllDebugSessions();
  });

  it('returns concise text part with breakpoint + filtered variables', async () => {
    const result = await invokeStartDebuggerTool({
      scriptRelativePath: 'test-workspace/b/test.js',
      configurationName: 'Run test.js',
      variableFilter: ['i'],
      breakpointSnippets: ['Loop iteration'],
      workspaceFolder: 'test-workspace/b',
    });

    const { content } = result;
    assert.ok(content.length === 1, 'tool should return a single prompt part');
    const promptPart = content[0];
    assert.ok(
      promptPart instanceof vscode.LanguageModelTextPart,
      'expected LanguageModelTextPart for concise output'
    );
    const textValue = promptPart.value as string;
    assert.match(textValue, /^Breakpoint .*:\d+/m, 'Missing breakpoint header');
    assert.match(textValue, /## Vars/, 'Missing Vars header');
    assert.match(
      textValue,
      /\|\s*i\s*\|[^|]*\|[^|]*\|/,
      'Filtered variable i missing in table'
    );
    console.log('[concise-output] preview:', textValue);
  });
});
