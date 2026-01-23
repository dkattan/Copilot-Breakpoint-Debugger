import type { BreakpointDefinition } from "./BreakpointDefinition";

export interface BreakpointConfiguration {
  breakpoints: BreakpointDefinition[]
}

type ServerReadyAction
  = | { shellCommand: string }
    | {
      httpRequest: {
        url: string
        method?: string
        headers?: Record<string, string>
        body?: string
      }
    }
    | { vscodeCommand: { command: string, args?: unknown[] } }
    | {
      type: "httpRequest"
      url: string
      method?: string
      headers?: Record<string, string>
      body?: string
    }
    | { type: "shellCommand", shellCommand: string }
    | { type: "vscodeCommand", command: string, args?: unknown[] };

export interface StartDebuggerToolParameters {
  workspaceFolder: string
  configurationName?: string
  /**
   * Tool mode:
   * - 'singleShot' (default): terminate the debug session before returning.
   * - 'inspect': allow returning while paused so the caller can inspect state and resume.
   */
  mode?: "singleShot" | "inspect"
  breakpointConfig: BreakpointConfiguration
  /**
   * Optional serverReady configuration.
   * trigger: defines when to run the action (breakpoint path+line OR pattern). If omitted and request === 'attach' the action runs immediately after attach (default immediate attach mode).
   * action: exactly one of shellCommand | httpRequest | vscodeCommand.
   */
  serverReady?: {
    trigger?: {
      path?: string
      line?: number
      pattern?: string
    }
    action: ServerReadyAction
  }
}
