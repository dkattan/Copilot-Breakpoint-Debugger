export type Part = { value?: string; text?: string } | string;

export interface StartDebuggerInvocationOptions {
  scriptRelativePath: string;
  variableFilter?: string[];
  configurationName?: string;
  breakpointSnippets?: string[];
  workspaceFolder?: string; // optional explicit workspace folder selection
}
export interface ToolInvocationResult {
  content?: unknown[];
  parts?: unknown[];
}
