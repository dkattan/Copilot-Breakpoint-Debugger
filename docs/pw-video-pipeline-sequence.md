# Playwright video trimming pipeline (sequence)

> Mermaid sequence diagram for the trace-driven trimming + optional dedupe + README update flow.
>
> In VS Code: open the Markdown preview (and if needed, ensure Mermaid is enabled in your Markdown preview settings/extensions).

```mermaid
sequenceDiagram
    autonumber
    actor Dev as Developer / CI
    participant PW as Playwright Test Runner
    participant FS as File System (test-results/**)
    participant Proc as Video Processor (external/playwright-test-videos)
    participant Trace as Trace Parser (trace.zip)
    participant FF as ffmpeg/ffprobe
    participant Art as E2E Artifacts (test-artifacts/e2e/**)
    participant RU as README Updater (<!-- pw-videos:start -->)

    Dev->>PW: Run tests (recordVideo + trace enabled)
    PW->>FS: Write raw video (*.webm)
    PW->>FS: Write trace (trace.zip)

    Dev->>Proc: Process test videos
    Proc->>Trace: Load + parse trace.zip
    Trace-->>Proc: Compute "remove ranges"\n(e.g., long waits) in video-time

    Proc->>FF: Trim video by keep-segments (filtergraph)
    FF->>FS: Write trimmed output (intermediate)

    alt Dedupe enabled
        Proc->>FF: mpdecimate + CFR enforcement + padding
        FF->>FS: Write deduped MP4
    else Dedupe disabled
        Proc->>FF: Encode MP4 (libx264 + faststart)
        FF->>FS: Write trimmed MP4
    end

    Proc->>Art: Copy/emit stable artifacts under test-artifacts/e2e/**
    Proc->>RU: Update README(s) between markers
    RU->>Art: Write per-test README.md and/or combined README.md

    Dev-->>Art: Review outputs (videos + README index)
```
