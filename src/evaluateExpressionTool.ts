import type {
  LanguageModelTool,
  LanguageModelToolInvocationOptions,
  LanguageModelToolInvocationPrepareOptions,
  ProviderResult,
} from 'vscode';
import * as vscode from 'vscode';
import { LanguageModelTextPart, LanguageModelToolResult } from 'vscode';
import { activeSessions, outputChannel } from './common';
import { DAPHelpers } from './debugUtils';

export interface EvaluateExpressionToolParameters {
  expression: string; // Expression to evaluate like in Debug Console
  sessionId: string; // Optional explicit session id; otherwise uses active debug session
  threadId: number; // Optional thread id for context
  frameId?: number; // Optional frame id for context
}

// DAP Evaluate Request Arguments
interface EvaluateArguments {
  expression: string;
  frameId?: number;
  context?: string;
  format?: {
    hex?: boolean;
  };
}

// DAP Evaluate Response
interface EvaluateResponse {
  result: string;
  type?: string;
  presentationHint?: {
    kind?: string;
    attributes?: string[];
    visibility?: string;
  };
  variablesReference: number;
  namedVariables?: number;
  indexedVariables?: number;
  memoryReference?: string;
}

export class EvaluateExpressionTool
  implements LanguageModelTool<EvaluateExpressionToolParameters>
{
  async invoke(
    options: LanguageModelToolInvocationOptions<EvaluateExpressionToolParameters>
  ): Promise<LanguageModelToolResult> {
    const { expression, sessionId, threadId } = options.input;
    try {
      // Resolve session
      let session: vscode.DebugSession | undefined;
      if (sessionId) {
        session = activeSessions.find(s => s.id === sessionId);
      }
      if (!session) {
        session = vscode.debug.activeDebugSession || activeSessions[0];
      }
      if (!session) {
        return new LanguageModelToolResult([
          new LanguageModelTextPart(
            'Error: No active debug session found to evaluate expression.'
          ),
        ]);
      }

      // Gather context (need frame id when paused). If not paused evaluation may still work for some adapters.
      const debugContext = await DAPHelpers.getDebugContext(session, threadId);

      const evalArgs: EvaluateArguments = { expression, context: 'watch' };
      if (debugContext?.frame?.id !== undefined) {
        evalArgs.frameId = debugContext.frame.id;
      }

      outputChannel.appendLine(
        `EvaluateExpressionTool: evaluating '${expression}' in session '${session.name}'.`
      );
      let evalResponse: EvaluateResponse;
      try {
        evalResponse = await session.customRequest('evaluate', evalArgs);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : JSON.stringify(err);
        return new LanguageModelToolResult([
          new LanguageModelTextPart(
            `Error evaluating expression '${expression}': ${message}`
          ),
        ]);
      }

      const resultJson = {
        expression,
        result: evalResponse?.result,
        type: evalResponse?.type,
        presentationHint: evalResponse?.presentationHint,
        variablesReference: evalResponse?.variablesReference,
      };
      return new LanguageModelToolResult([
        new LanguageModelTextPart(JSON.stringify(resultJson)),
      ]);
    } catch (error) {
      return new LanguageModelToolResult([
        new LanguageModelTextPart(
          `Unexpected error evaluating expression: ${
            error instanceof Error ? error.message : String(error)
          }`
        ),
      ]);
    }
  }

  prepareInvocation?(
    options: LanguageModelToolInvocationPrepareOptions<EvaluateExpressionToolParameters>
  ): ProviderResult<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: `Evaluating expression '${options.input.expression}' in debug session`,
    };
  }
}
