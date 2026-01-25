export type Part = { value?: string, text?: string } | string;

export interface StartDebuggerInvocationOptions {
  scriptRelativePath: string
  variable?: string
  configurationName?: string
  breakpointSnippets?: string[]
  workspaceFolder?: string // optional explicit workspace folder selection
}
export interface ToolInvocationResult {
  content?: unknown[]
  parts?: unknown[]
}

/**
 * Subset of DAP initialize response capabilities we care about when probing the
 * built-in Node/JavaScript debug adapter.
 */
export interface InitializeCapabilities {
  supportsConditionalBreakpoints?: boolean
  supportsHitConditionalBreakpoints?: boolean
  supportsLogPoints?: boolean
  supportsFunctionBreakpoints?: boolean
  supportsDataBreakpoints?: boolean
  supportsInstructionBreakpoints?: boolean
  supportsExceptionOptions?: boolean
  exceptionBreakpointFilters?: Array<{ filter?: string }>
}
