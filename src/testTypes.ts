export interface ToolResultPart {
  text?: string;
  value?: string;
}

export type Part = { value?: string; text?: string } | string;

export interface StartDebuggerInvocationOptions {
  scriptRelativePath: string;
  timeoutSeconds?: number;
  variableFilter?: string[];
  configurationName?: string;
  breakpointLines?: number[];
}
export interface ToolInvocationResult {
  content?: unknown[];
  parts?: unknown[];
}
