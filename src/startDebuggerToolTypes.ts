import type { BreakpointDefinition } from "./BreakpointDefinition";

export interface BreakpointConfiguration {
  breakpoints: BreakpointDefinition[]
  /**
   * Optional serverReady breakpoint trigger executed when the server is ready.
   * Used together with StartDebuggerToolParameters.serverReady.
   */
  breakpointTrigger?: ServerReadyAction
}

type ServerReadyAction
  = | {
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
   * Optional task label to auto-start before launching the debugger.
   * Intended for long-running watcher tasks (e.g. `dotnet watch run`).
   */
  watcherTaskLabel?: string
  /**
   * Tool mode:
   * - 'singleShot' (default): terminate the debug session before returning.
   * - 'inspect': allow returning while paused so the caller can inspect state and resume.
   */
  mode?: "singleShot" | "inspect"
  breakpointConfig: BreakpointConfiguration
  /**
   * Optional serverReady configuration.
   * Defines when to run breakpointConfig.breakpointTrigger (breakpoint path+code OR pattern).
   * If omitted and request === 'attach', the trigger runs immediately after attach (default immediate attach mode).
   */
  serverReady?: {
    path?: string
    code?: string
    pattern?: string
  }
}
