import type { DebugProtocol } from "@vscode/debugprotocol";
import type * as vscode from "vscode";
import { LanguageModelTextPart, LanguageModelToolResult } from "vscode";
import { truncateToolOutputText } from "./outputTruncation";

// Re-export DAP types for convenience
export type Thread = DebugProtocol.Thread;
export type StackFrame = DebugProtocol.StackFrame;
export type Scope = DebugProtocol.Scope;
export type Variable = DebugProtocol.Variable;

export interface VariableInfo {
  name: string
  value: string
  type?: string
  isExpandable: boolean
}

export interface ScopeInfo {
  name: string
  variables: VariableInfo[]
}

export interface VariablesData {
  type: "variables"
  sessionId: string
  scopes: ScopeInfo[]
  filtered?: boolean
  filterPattern?: string
}

export interface VariablesResponse {
  variables: Variable[]
}

export interface DebugContext {
  thread: Thread
  frame: StackFrame
  scopes: Scope[]
}

export interface FoundVariable {
  variable: VariableInfo
  scopeName: string
}

// Shared DAP helper functions
export class DAPHelpers {
  private static async customRequestWithTimeout<T>(
    session: vscode.DebugSession,
    command: string,
    args: Record<string, unknown> | undefined,
    timeoutMs: number,
  ): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<T>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(
          new Error(
            `DAP request '${command}' timed out after ${timeoutMs}ms (session ${session.id} ${session.name}).`,
          ),
        );
      }, timeoutMs);
    });

    try {
      return await Promise.race([
        session.customRequest(command, args),
        timeoutPromise,
      ]);
    }
    finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  static async getDebugContext(
    session: vscode.DebugSession,
    threadId?: number,
  ): Promise<DebugContext> {
    // Step 1: Get threads
    const dapTimeoutMs = 15_000;
    const { threads } = (await this.customRequestWithTimeout(
      session,
      "threads",
      undefined,
      dapTimeoutMs,
    )) as { threads: Thread[] };

    if (!threads || threads.length === 0) {
      throw new Error(
        `No threads available in session ${session.id} (${session.name})`,
      );
    }
    const effectiveThreadId
      = typeof threadId === "number" ? threadId : threads[0].id;
    const thread: Thread | undefined = threads.find(
      t => t.id === effectiveThreadId,
    );
    if (!thread) {
      throw new Error(
        `Thread with id ${effectiveThreadId} not found in session ${session.id} (${session.name})`,
      );
    }
    // Step 2: Get stack trace for the first thread
    const stackTraceResponse = await this.customRequestWithTimeout<{
      stackFrames?: StackFrame[]
    }>(
      session,
      "stackTrace",
      { threadId: thread.id },
      dapTimeoutMs,
    );
    if (
      !stackTraceResponse.stackFrames
      || stackTraceResponse.stackFrames.length === 0
    ) {
      throw new Error(
        `No stack frames available for thread ${thread.id} in session ${session.id} (${session.name})`,
      );
    }
    const topFrame: StackFrame = stackTraceResponse.stackFrames[0];

    // Step 3: Get scopes for the top frame
    const scopesResponse = await this.customRequestWithTimeout<{
      scopes?: Scope[]
    }>(
      session,
      "scopes",
      { frameId: topFrame.id },
      dapTimeoutMs,
    );
    if (!scopesResponse.scopes || scopesResponse.scopes.length === 0) {
      throw new Error(
        `No scopes available for frame ${topFrame.id} in session ${session.id} (${session.name})`,
      );
    }

    return {
      thread,
      frame: topFrame,
      scopes: scopesResponse.scopes,
    };
  }

  static async getVariablesFromReference(
    session: vscode.DebugSession,
    variablesReference: number,
  ): Promise<VariableInfo[]> {
    let variablesResponse: VariablesResponse;
    try {
      const dapTimeoutMs = 15_000;
      variablesResponse = await this.customRequestWithTimeout(
        session,
        "variables",
        { variablesReference },
        dapTimeoutMs,
      );
    }
    catch {
      return [];
    }
    if (!variablesResponse?.variables) {
      return [];
    }
    const filtered = variablesResponse.variables.filter((v: Variable) => {
      const type = v.type?.toLowerCase();
      if (type === "function") {
        return false;
      }
      if (!type && typeof v.value === "string") {
        // Some adapters omit type but include a "function ..." value string.
        return !v.value.startsWith("function");
      }
      return true;
    });
    return filtered.map((v: Variable) => ({
      name: v.evaluateName || v.name,
      value: v.value,
      type: v.type,
      isExpandable: v.variablesReference > 0,
    }));
  }

  static async findVariableInScopes(
    session: vscode.DebugSession,
    scopes: Scope[],
    variableName: string,
  ): Promise<FoundVariable | null> {
    for (const scope of scopes) {
      const variables = await this.getVariablesFromReference(
        session,
        scope.variablesReference,
      );
      const foundVariable = variables.find(v => v.name === variableName);
      if (foundVariable) {
        return { variable: foundVariable, scopeName: scope.name };
      }
    }
    return null;
  }

  static createSuccessResult(message: string): LanguageModelToolResult {
    const textPart = new LanguageModelTextPart(
      truncateToolOutputText(message).text,
    );
    return new LanguageModelToolResult([textPart]);
  }

  static createErrorResult(message: string): LanguageModelToolResult {
    const textPart = new LanguageModelTextPart(
      truncateToolOutputText(`Error: ${message}`).text,
    );
    return new LanguageModelToolResult([textPart]);
  }
}
