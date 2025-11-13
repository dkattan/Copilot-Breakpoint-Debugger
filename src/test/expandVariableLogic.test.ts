import type { Breakpoint, DebugConfiguration, DebugSession } from 'vscode';
import * as assert from 'node:assert';
import { expandVariableInSession } from '../expandVariableTool';

// Lightweight mock DebugSession implementing only customRequest we need.
class MockDebugSession implements DebugSession {
  id = 'mock-session';
  type = 'node';
  name = 'mock';
  workspaceFolder = undefined;
  configuration: DebugConfiguration = {
    type: 'node',
    name: 'mock',
    request: 'launch',
  };
  customRequest(
    command: string,
    args?: { variablesReference?: number }
  ): Promise<unknown> {
    switch (command) {
      case 'threads':
        return Promise.resolve({
          body: { threads: [{ id: 1, name: 'Main' }] },
        });
      case 'stackTrace':
        return Promise.resolve({
          stackFrames: [
            {
              id: 10,
              name: 'frame',
              line: 5,
              column: 1,
              source: { path: 'mockFile.js' },
            },
          ],
        });
      case 'scopes':
        return Promise.resolve({
          scopes: [
            {
              name: 'Local',
              variablesReference: 100,
              expensive: false,
              indexedVariables: 0,
              namedVariables: 0,
            },
          ],
        });
      case 'variables':
        if (args && args.variablesReference === 100) {
          return Promise.resolve({
            variables: [
              {
                name: 'process',
                evaluateName: 'process',
                value: '[object Process]',
                type: 'object',
                variablesReference: 200,
              },
              {
                name: 'randomValue',
                evaluateName: 'randomValue',
                value: '42',
                type: 'number',
                variablesReference: 0,
              },
            ],
          });
        }
        if (args && args.variablesReference === 200) {
          return Promise.resolve({
            variables: [
              {
                name: 'version',
                evaluateName: 'version',
                value: 'v1',
                type: 'string',
                variablesReference: 0,
              },
            ],
          });
        }
        return Promise.resolve({ variables: [] });
      default:
        return Promise.reject(
          new Error(`Unexpected customRequest: ${command}`)
        );
    }
  }
  // Unused DebugSession API members with minimal stubs (not exercised in tests)
  getDebugProtocolBreakpoint(_breakpoint: Breakpoint) {
    return Promise.resolve(undefined);
  }
  configurationArguments = {} as Record<string, unknown>;
  parentSession = undefined;
  onDidCustomEvent = { dispose() {} } as { dispose: () => void };
  onDidChangeName = { dispose() {} } as { dispose: () => void };
  addCustomEventListener() {
    return { dispose() {} };
  }
}

describe('expandVariableInSession (logic unit test)', () => {
  it('expands an expandable variable and returns children', async () => {
    const session = new MockDebugSession();
    const result = await expandVariableInSession(session, 'process');
    assert.strictEqual(result.variable.name, 'process');
    assert.ok(result.variable.isExpandable, 'process should be expandable');
    assert.ok(
      result.children.length > 0,
      'Expandable variable should have children'
    );
  });

  it('returns empty children for non-expandable variable', async () => {
    const session = new MockDebugSession();
    const result = await expandVariableInSession(session, 'randomValue');
    assert.strictEqual(result.variable.name, 'randomValue');
    assert.strictEqual(result.variable.isExpandable, false);
    assert.strictEqual(result.children.length, 0);
  });

  it('throws for missing variable', async () => {
    const session = new MockDebugSession();
    await assert.rejects(
      () => expandVariableInSession(session, 'doesNotExist'),
      /not found/i
    );
  });
});
