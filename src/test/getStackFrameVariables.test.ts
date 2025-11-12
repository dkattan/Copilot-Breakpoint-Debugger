import type * as vscode from 'vscode';
import * as assert from 'node:assert';
import { activeSessions } from '../common';
import { getStackFrameVariables } from '../inspection';

describe('getStackFrameVariables filter behavior', () => {
  beforeEach(() => {
    // Clear and insert mock session before each test to ensure isolation
    activeSessions.splice(0, activeSessions.length);
    activeSessions.push({
      id: 'mock-session',
      name: 'mock',
      type: 'mockType',
      workspaceFolder: undefined,
      configuration: {},
      customRequest: (
        method: string,
        args?: { variablesReference?: number }
      ) => {
        if (method === 'scopes') {
          return {
            scopes: [
              { name: 'Local', variablesReference: 1 },
              { name: 'Empty', variablesReference: 0 },
            ],
          };
        }
        if (method === 'variables') {
          if (args?.variablesReference === 1) {
            return {
              variables: [
                { name: 'alpha', value: '1' },
                { name: 'beta', value: '2' },
                { name: 'gamma', value: '3' },
              ],
            };
          }
          return { variables: [] };
        }
        throw new Error(`Unexpected method ${method}`);
      },
    } as unknown as vscode.DebugSession);
  });

  it('returns all variables when no filter provided', async () => {
    const result = await getStackFrameVariables({
      sessionId: 'mock-session',
      frameId: 10,
      threadId: 1,
    });

    const localScope = result.variablesByScope.find(
      s => s.scopeName === 'Local'
    );
    assert.ok(localScope, 'Local scope missing');
    assert.strictEqual(
      localScope.variables.length,
      3,
      'Expected 3 variables unfiltered'
    );
  });

  it('filters variables by regex fragments', async () => {
    const result = await getStackFrameVariables({
      sessionId: 'mock-session',
      frameId: 10,
      threadId: 1,
      filter: 'alpha|gamma',
    });
    // assert.strictEqual(result.isError, false, 'Result should not be error');

    const localScope = result.variablesByScope.find(
      s => s.scopeName === 'Local'
    );
    assert.ok(localScope, 'Local scope missing');
    const names = localScope.variables
      .map((v: { name: string }) => v.name)
      .sort();
    assert.deepStrictEqual(
      names,
      ['alpha', 'gamma'],
      'Filtered variables should be alpha and gamma'
    );
  });

  it('filter excluding all yields empty array', async () => {
    const result = await getStackFrameVariables({
      sessionId: 'mock-session',
      frameId: 10,
      threadId: 1,
      filter: 'delta',
    });
    const localScope = result.variablesByScope.find(
      s => s.scopeName === 'Local'
    );
    assert.ok(localScope, 'Local scope missing');
    assert.strictEqual(
      localScope.variables.length,
      0,
      'No variables should match filter'
    );
  });
});
