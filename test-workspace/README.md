# Test Workspace

This directory contains test workspaces for validating the Copilot Debugger extension with multi-root workspace configurations.

## Structure

```
test-workspace/
├── a/                      # PowerShell test workspace
│   ├── .vscode/
│   │   ├── launch.json    # PowerShell debug config
│   │   └── settings.json  # Default launch config setting
│   └── test.ps1           # PowerShell test script with loop
│
└── b/                      # Node.js test workspace
    ├── .vscode/
    │   ├── launch.json    # Node.js debug config
    │   └── settings.json  # Default launch config setting
    └── test.js            # JavaScript test script with loop
```

## Usage

### Option 1: Open Multi-Root Workspace (Recommended for Testing)

Open the pre-configured multi-root workspace:

```bash
code test-workspace.code-workspace
```

This workspace includes:
- Both workspaces (a and b) loaded simultaneously
- Individual launch configurations for each workspace
- **Compound launch configuration** that debugs both at once
- Recommended extensions

### Option 2: Open Individual Workspaces

Test each workspace separately:

```bash
# PowerShell workspace
code test-workspace/a

# Node.js workspace
code test-workspace/b
```

## Testing Scenarios

### 1. Basic Breakpoints

Set a breakpoint on line 1 of either test file and start debugging.

### 2. Conditional Breakpoints

**PowerShell (`test.ps1` line 8):**
```
condition: $i -ge 3
```

**Node.js (`test.js` line 9):**
```
condition: i >= 3
```

### 3. Hit Condition Breakpoints

Trigger only on the 3rd hit:
```
hitCondition: 3
```

### 4. Logpoints

**PowerShell:**
```
logMessage: Loop iteration: {$i}
```

**Node.js:**
```
logMessage: Loop iteration: {i}
```

### 5. Compound Debugging

1. Open `test-workspace.code-workspace`
2. Select "Debug Both (Compound)" from the debug dropdown
3. Press F5 to debug both PowerShell and Node.js simultaneously

## Copilot Integration

When using GitHub Copilot with this extension, you can issue commands like:

```
Start the debugger in the PowerShell workspace and stop at line 8 when $i >= 3
```

```
Debug the Node.js test with a breakpoint at line 9 and show me the value of i
```

```
Run both tests using the compound configuration
```

## Prerequisites

- **PowerShell Extension**: Required for debugging `test.ps1`
  - Install: `ms-vscode.powershell`

- **Node.js**: Required for debugging `test.js`
  - Built-in VS Code debugger (no extension needed)

- **Copilot Debugger Extension**: This extension
  - Install: `dkattan.copilot-debugger` (or run from source)

## Test Scripts

Both test scripts contain:
- Console output with current directory
- Random value generation
- Loop with 5 iterations (lines 7-10 in PS1, lines 8-13 in JS)
- Multiple executable lines for breakpoint placement
- Built-in delays for realistic debugging

These scripts are used by the automated test suite in `src/test/`.
