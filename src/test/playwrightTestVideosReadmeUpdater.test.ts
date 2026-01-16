import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const DEFAULT_START_MARKER = "<!-- pw-videos:start -->";
const DEFAULT_END_MARKER = "<!-- pw-videos:end -->";

const formatMarkdown = (videosRelPaths: string[]): string =>
  videosRelPaths
    .map(
      (v) =>
        `<video src="${v}" controls muted playsinline style="max-width: 100%;"></video>`
    )
    .join("\n\n");

const replaceBlock = (
  text: string,
  newBlock: string,
  startMarker: string,
  endMarker: string
): string => {
  const startIdx = text.indexOf(startMarker);
  const endIdx = text.indexOf(endMarker);
  if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) {
    throw new Error(
      `README is missing token block. Expected '${startMarker}' then '${endMarker}'.`
    );
  }
  const before = text.slice(0, startIdx + startMarker.length);
  const after = text.slice(endIdx);
  return `${before}\n${newBlock}\n${after}`;
};

const updateReadmeForVideos = (options: {
  readmePath: string;
  videoPaths: string[];
  startMarker?: string;
  endMarker?: string;
}): void => {
  const {
    readmePath,
    videoPaths,
    startMarker = DEFAULT_START_MARKER,
    endMarker = DEFAULT_END_MARKER,
  } = options;

  const repoRoot = path.dirname(readmePath);
  const relPaths = videoPaths.map((p) =>
    path.relative(repoRoot, p).replaceAll(path.sep, "/")
  );

  const readme = fs.readFileSync(readmePath, "utf8");
  const newBlock = formatMarkdown(relPaths);
  const updated = replaceBlock(readme, newBlock, startMarker, endMarker);
  fs.writeFileSync(readmePath, updated);
};

describe("playwright-test-videos README updater", () => {
  it("does not alter relative paths in import statements outside marker block", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-videos-"));
    const readmePath = path.join(tmpDir, "README.md");
    const outDir = path.join(tmpDir, "docs", "pw-videos");

    const importLine = "import { foo } from './relative/module.js';";

    fs.writeFileSync(
      readmePath,
      [
        "# Title",
        "",
        "```ts",
        importLine,
        "```",
        "",
        "<!-- pw-videos:start -->",
        "(placeholder)",
        "<!-- pw-videos:end -->",
        "",
      ].join("\n"),
      "utf8"
    );

    const fakeVideoAbsPath = path.join(outDir, "demo.mp4");
    fs.mkdirSync(path.dirname(fakeVideoAbsPath), { recursive: true });
    fs.writeFileSync(fakeVideoAbsPath, "not-a-real-video", "utf8");

    updateReadmeForVideos({
      readmePath,
      videoPaths: [fakeVideoAbsPath],
    });

    const updated = fs.readFileSync(readmePath, "utf8");

    // The code block should be preserved verbatim; we must not turn './relative/module.js'
    // into a markdown link or otherwise mutate the import statement.
    assert.ok(updated.includes(importLine));

    // Sanity: the injected block should include a <video> tag referencing our relative mp4.
    assert.match(updated, /<video\s+src="docs\/pw-videos\/demo\.mp4"/);
  });
});
