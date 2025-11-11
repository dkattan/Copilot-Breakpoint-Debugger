import type { DebugProtocol } from '@vscode/debugprotocol';
import type * as vscode from 'vscode';
import { LanguageModelTextPart, LanguageModelToolResult } from 'vscode';

// Re-export DAP types for convenience
export type Thread = DebugProtocol.Thread;
export type StackFrame = DebugProtocol.StackFrame;
export type Scope = DebugProtocol.Scope;
export type Variable = DebugProtocol.Variable;

export interface VariableInfo {
  name: string;
  value: string;
  type?: string;
  isExpandable: boolean;
}

export interface ScopeInfo {
  name: string;
  variables: VariableInfo[];
}

export interface VariablesData {
  type: 'variables';
  sessionId: string;
  scopes: ScopeInfo[];
  filtered?: boolean;
  filterPattern?: string;
}

export interface VariablesResponse {
  variables: Variable[];
}

export interface DebugContext {
  thread: Thread;
  frame: StackFrame;
  scopes: Scope[];
}

export interface FoundVariable {
  variable: VariableInfo;
  scopeName: string;
}

// Shared DAP helper functions
export class DAPHelpers {
  static async getDebugContext(
    session: vscode.DebugSession
  ): Promise<DebugContext | null> {
    try {
      // Step 1: Get threads
      const threadsResponse = await session.customRequest('threads');
      if (!threadsResponse.threads || threadsResponse.threads.length === 0) {
        return null;
      }
      const firstThread: Thread = threadsResponse.threads[0];

      // Step 2: Get stack trace for the first thread
      const stackTraceResponse = await session.customRequest('stackTrace', {
        threadId: firstThread.id,
      });
      if (
        !stackTraceResponse.stackFrames ||
        stackTraceResponse.stackFrames.length === 0
      ) {
        return null;
      }
      const topFrame: StackFrame = stackTraceResponse.stackFrames[0];

      // Step 3: Get scopes for the top frame
      const scopesResponse = await session.customRequest('scopes', {
        frameId: topFrame.id,
      });
      if (!scopesResponse.scopes || scopesResponse.scopes.length === 0) {
        return null;
      }

      return {
        thread: firstThread,
        frame: topFrame,
        scopes: scopesResponse.scopes,
      };
    } catch {
      return null;
    }
  }

  static async getVariablesFromReference(
    session: vscode.DebugSession,
    variablesReference: number
  ): Promise<VariableInfo[]> {
    let variablesResponse: VariablesResponse;
    try {
      variablesResponse = await session.customRequest('variables', {
        variablesReference,
      });
    } catch {
      return [];
    }
    if (!variablesResponse?.variables) {
      return [];
    }
    return variablesResponse.variables.map((v: Variable) => ({
      name: v.evaluateName || v.name,
      value: v.value,
      type: v.type,
      isExpandable: v.variablesReference > 0,
    }));
  }

  static async findVariableInScopes(
    session: vscode.DebugSession,
    scopes: Scope[],
    variableName: string
  ): Promise<FoundVariable | null> {
    for (const scope of scopes) {
      const variables = await this.getVariablesFromReference(
        session,
        scope.variablesReference
      );
      const foundVariable = variables.find(v => v.name === variableName);
      if (foundVariable) {
        return { variable: foundVariable, scopeName: scope.name };
      }
    }
    return null;
  }

  static createSuccessResult(message: string): LanguageModelToolResult {
    const textPart = new LanguageModelTextPart(message);
    return new LanguageModelToolResult([textPart]);
  }

  static createErrorResult(message: string): LanguageModelToolResult {
    const textPart = new LanguageModelTextPart(`Error: ${message}`);
    return new LanguageModelToolResult([textPart]);
  }
}
