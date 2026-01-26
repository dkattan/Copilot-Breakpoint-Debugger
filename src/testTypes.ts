// DAP initialize response capabilities (a small, intentionally loose subset).
// Used by integration tests to summarize adapter support without hardcoding values.
export interface InitializeCapabilities {
  exceptionBreakpointFilters?: unknown
  supportsConditionalBreakpoints?: boolean
  supportsHitConditionalBreakpoints?: boolean
  supportsLogPoints?: boolean
  supportsFunctionBreakpoints?: boolean
  supportsDataBreakpoints?: boolean
  supportsInstructionBreakpoints?: boolean
  supportsExceptionOptions?: boolean
}

export interface StartDebuggerInvocationOptions {
  scriptRelativePath: string
  variable?: string
  configurationName?: string
  breakpointSnippets?: string[]
  workspaceFolder?: string // optional explicit workspace folder selection
}
