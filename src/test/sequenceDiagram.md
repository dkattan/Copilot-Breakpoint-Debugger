```mermaid
sequenceDiagram
autonumber
participant U as User (npm test)
participant RT as Node: runTest.ts
participant DL as downloadAndUnzipVSCode()
participant TE as @vscode/test-electron runTests()
participant VC as Spawned VS Code (Extension Dev Host)
participant EX as Your Extension Activation
participant MT as Mocha Test Runner
participant IT as startDebuggerTool.integration.test
participant SDT as StartDebuggerTool.invoke()
participant SES as session.startDebuggingAndWaitForStop()
participant EVT as events.waitForBreakpointHit()
participant VSCD as vscode.debug.startDebugging()
participant PSE as PowerShell Extension
participant DA as PowerShell Debug Adapter
participant TRK as DebugAdapterTracker (events.ts)
participant CB as getCallStack()
participant VAR as getStackFrameVariables()
participant RES as resolveBreakpointInfo()
participant OUT as LanguageModelToolResult

U->>RT: Execute npm test (runs compiled out/test/runTest.js)
RT->>DL: downloadAndUnzipVSCode('stable')
DL-->>RT: VS Code executable path
RT->>TE: runTests({ extensionDevelopmentPath, extensionTestsPath, launchArgs })
TE->>VC: Launch new VS Code process (Extension Dev Host)
VC->>EX: Activate extension (package.json activation events)
VC->>MT: Run compiled test suite
MT->>IT: Execute integration test “starts debugger…”
IT->>VC: Ensure workspace folder; open test.ps1; add breakpoint
IT->>PSE: Activate PowerShell extension (if not already)
IT->>SDT: Call StartDebuggerTool.invoke()
SDT->>SES: startDebuggingAndWaitForStop({ configurationName })
SES->>EVT: Prepare stopPromise (waitForBreakpointHit with sessionId + timeout)
SES->>VSCD: vscode.debug.startDebugging(folder, configName, { id })
VSCD->>PSE: Request launch (PowerShell debug)
PSE->>DA: Start debug adapter process
DA->>TRK: Emit debug protocol events (e.g. initialized, continued)
IT-->>EVT: (Meanwhile test waiting for stopPromise)
TRK->>TRK: Intercept 'stopped' event
TRK->>CB: getCallStack(sessionName)
CB-->>TRK: Call stack JSON
TRK->>EVT: Emit BreakpointHitInfo via EventEmitter
EVT-->>SES: stopPromise resolves with BreakpointHitInfo
SES->>RES: resolveBreakpointInfo(breakpointInfo, variableFilter?)
RES->>VAR: getStackFrameVariables(frameId, threadId, filter?)
VAR-->>RES: Filtered variables (or error)
RES-->>SES: Debug info content (text + JSON)
SES-->>SDT: Raw result (content parts)
SDT->>OUT: Wrap into LanguageModelToolResult (text parts)
OUT-->>IT: Result returned
IT->>IT: Assertions on breakpoint, line, absence of errors
```
