import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { createTerminalOutputCapture } from '../session';

describe('terminal output capture', () => {
  const mockTerminal = (name: string): vscode.Terminal => {
    return {
      name,
      creationOptions: {},
      state: { isInteractedWith: false },
      processId: undefined,
      exitStatus: undefined,
      sendText: () => undefined,
      show: () => undefined,
      hide: () => undefined,
      dispose: () => undefined,
      shellIntegration: undefined,
    } as unknown as vscode.Terminal;
  };

  const mockExecution = (chunks: string[]): vscode.TerminalShellExecution => {
    const iterator = (async function* () {
      for (const chunk of chunks) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        yield chunk;
      }
    })();
    return {
      commandLine: 'mock',
      read: () => iterator,
    } as unknown as vscode.TerminalShellExecution;
  };

  const mockShellIntegration = (
    execution: vscode.TerminalShellExecution
  ): vscode.TerminalShellIntegration => {
    return {
      cwd: undefined,
      executeCommand: ((..._args: unknown[]) =>
        execution) as vscode.TerminalShellIntegration['executeCommand'],
    } as vscode.TerminalShellIntegration;
  };

  const overrideProperty = (
    target: object,
    property: string,
    descriptor: PropertyDescriptor
  ) => {
    const original = Object.getOwnPropertyDescriptor(target, property);
    Object.defineProperty(target, property, {
      configurable: true,
      ...descriptor,
    });
    return () => {
      if (original) {
        Object.defineProperty(target, property, original);
      } else {
        delete (target as Record<string, unknown>)[property];
      }
    };
  };

  it('captures shell integration chunks', async function () {
    this.timeout(5000);

    const startEmitter =
      new vscode.EventEmitter<vscode.TerminalShellExecutionStartEvent>();
    const endEmitter =
      new vscode.EventEmitter<vscode.TerminalShellExecutionEndEvent>();
    const openEmitter = new vscode.EventEmitter<vscode.Terminal>();
    const terminals: vscode.Terminal[] = [];

    const restorers: Array<() => void> = [];
    try {
      restorers.push(
        overrideProperty(vscode.window as object, 'terminals', {
          get: () => terminals,
        })
      );
      restorers.push(
        overrideProperty(vscode.window as object, 'onDidOpenTerminal', {
          value: openEmitter.event,
        })
      );
      restorers.push(
        overrideProperty(
          vscode.window as object,
          'onDidStartTerminalShellExecution',
          {
            value: startEmitter.event,
          }
        )
      );
      restorers.push(
        overrideProperty(
          vscode.window as object,
          'onDidEndTerminalShellExecution',
          {
            value: endEmitter.event,
          }
        )
      );
    } catch {
      restorers.forEach((restore) => restore());
      this.skip();
      return;
    }

    const capture = createTerminalOutputCapture(10);
    const terminal = mockTerminal('Debug Terminal');
    terminals.push(terminal);
    openEmitter.fire(terminal);

    const execution = mockExecution([
      'ERROR: Something failed\n',
      'CRASH: Terminal output\n',
    ]);

    const shellIntegration = mockShellIntegration(execution);
    startEmitter.fire({ terminal, execution, shellIntegration });
    await new Promise((resolve) => setTimeout(resolve, 20));
    endEmitter.fire({ terminal, execution, shellIntegration, exitCode: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const snapshot = capture.snapshot();
    capture.dispose();
    restorers.forEach((restore) => restore());
    startEmitter.dispose();
    endEmitter.dispose();
    openEmitter.dispose();

    assert.ok(
      snapshot.some((line) => line.includes('CRASH: Terminal output')),
      `Expected captured terminal lines. Got: ${snapshot.join(', ')}`
    );
    assert.ok(
      snapshot.every((line) => line.startsWith('Debug Terminal')),
      `Terminal lines should include terminal name. Got: ${snapshot.join(', ')}`
    );
  });
});
