import type {
  LanguageModelTool,
  LanguageModelToolInvocationOptions,
  LanguageModelToolInvocationPrepareOptions,
  LanguageModelToolResult,
  ProviderResult,
} from "vscode";
import type { VariablesData } from "./debugUtils";
import * as vscode from "vscode";
import { DAPHelpers } from "./debugUtils";

export interface GetVariablesToolParameters {}

export class GetVariablesTool implements LanguageModelTool<GetVariablesToolParameters> {
  /**
   * Get all variables from the active debug session as structured data.
   * @returns VariablesData object or throws an error
   */
  async getVariables(): Promise<VariablesData> {
    // Check if there's an active debug session
    const activeSession = vscode.debug.activeDebugSession;
    if (!activeSession) {
      throw new Error("No active debug session found");
    }

    // Get debug context (threads, frames, scopes)
    const debugContext = await DAPHelpers.getDebugContext(activeSession);
    if (!debugContext) {
      throw new Error(
        "Unable to get debug context (threads, frames, or scopes)",
      );
    }

    // Get all variables from all scopes (domain shape)
    const variablesData: VariablesData = {
      type: "variables",
      sessionId: activeSession.id,
      scopes: [],
    };

    for (const scope of debugContext.scopes) {
      const variables = await DAPHelpers.getVariablesFromReference(
        activeSession,
        scope.variablesReference,
      );
      if (variables.length > 0) {
        variablesData.scopes.push({ name: scope.name, variables });
      }
    }

    if (variablesData.scopes.length === 0) {
      throw new Error("No variables found in current scope");
    }

    return variablesData;
  }

  async invoke(
    _options: LanguageModelToolInvocationOptions<GetVariablesToolParameters>,
  ): Promise<LanguageModelToolResult> {
    try {
      const variablesData = await this.getVariables();
      const serialized = JSON.stringify(variablesData, null, 2);
      return DAPHelpers.createSuccessResult(serialized);
    }
    catch (error) {
      const errorMessage
        = error instanceof Error ? error.message : "Unknown error occurred";
      return DAPHelpers.createErrorResult(
        `Failed to get variables: ${errorMessage}`,
      );
    }
  }

  prepareInvocation?(
    _options: LanguageModelToolInvocationPrepareOptions<GetVariablesToolParameters>,
  ): ProviderResult<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: "Getting all variables from debug session",
    };
  }
}
