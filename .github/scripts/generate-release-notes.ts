/**
 * Release notes generator (TypeScript).
 *
 * - In CI: requires VERSION/PREV_TAG/COMMITS/STATS and writes RELEASE_NOTES.md + updates CHANGELOG.md.
 * - Locally: computes the same context from git tags/logs and does the same outputs.
 *
 * Requirements:
 * - ANTHROPIC_TOKEN (or ANTHROPIC_API_KEY)
 * - git history available (run from a clone with tags) for local mode
 *
 * Run via: npm run release:notes
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import process from "node:process";

import { unstable_v2_prompt } from "@anthropic-ai/claude-agent-sdk";

function runGit(args: string[]): string {
  const res = spawnSync("git", args, { encoding: "utf8" });
  if (res.status !== 0) {
    const stderr = (res.stderr || "").trim();
    throw new Error(
      `git ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`,
    );
  }
  return (res.stdout || "").trimEnd();
}

function computeNextVersion(prevTagRaw: string): {
  version: string
  prevTagRaw: string
} {
  if (!prevTagRaw) {
    return { version: "0.0.1", prevTagRaw: "" };
  }

  const prev = prevTagRaw.replace(/^v/, "");
  const parts = prev.split(".");
  if (parts.length !== 3 || parts.some(p => Number.isNaN(Number(p)))) {
    throw new Error(`Latest tag '${prevTagRaw}' is not semver x.y.z`);
  }

  parts[2] = String(Number(parts[2]) + 1);
  return { version: parts.join("."), prevTagRaw };
}

function buildContext(prevTag: string): { commits: string, stats: string } {
  const range = prevTag ? `${prevTag}..HEAD` : "";
  const commits = `${runGit([
    "log",
    "--pretty=format:- %s (%an) [%h]",
    ...(range ? [range] : []),
  ])}\n`;

  // Match CI behavior: git diff --stat for a range, else git show --stat.
  const stats = range
    ? runGit(["diff", "--stat", range])
    : runGit(["show", "--stat"]);

  return { commits, stats };
}

function getCiContextFromEnv(): {
  version?: string
  prevTag?: string
  commits?: string
  stats?: string
} {
  // These are the same variable names produced/used by the GitHub Actions workflow.
  // If present, we treat them as authoritative so CI and local runs behave consistently.
  const version = (process.env.VERSION ?? "").trim() || undefined;
  const prevTag = (process.env.PREV_TAG ?? "").trim() || undefined;
  const commits = process.env.COMMITS;
  const stats = process.env.STATS;

  return {
    version,
    prevTag,
    commits: commits && commits.trim() ? commits : undefined,
    stats: stats && stats.trim() ? stats : undefined,
  };
}

function isRunningInGitHubActions(): boolean {
  return process.env.GITHUB_ACTIONS === "true";
}

function fillPromptTemplate(params: {
  workspaceRoot: string
  version: string
  prevTag: string
  commits: string
  stats: string
}): string {
  const promptPath = path.join(
    params.workspaceRoot,
    ".github/prompts/release-notes.md",
  );
  const promptTemplate = fs.readFileSync(promptPath, "utf8");

  /* eslint-disable no-template-curly-in-string */
  return promptTemplate
    .replace("${{ steps.version.outputs.version }}", params.version)
    .replace("${{ steps.version.outputs.previous_tag }}", params.prevTag)
    .replace("${{ steps.context.outputs.commits }}", params.commits)
    .replace("${{ steps.context.outputs.stats }}", params.stats);
  /* eslint-enable no-template-curly-in-string */
}

function updateChangelog(params: { version: string, content: string }): void {
  const changelogPath = "CHANGELOG.md";
  const existing = fs.existsSync(changelogPath)
    ? fs.readFileSync(changelogPath, "utf8")
    : "";

  const date = new Date().toISOString().split("T")[0];
  const newEntry = `## [${params.version}] - ${date}\n\n${params.content}\n\n`;

  let next: string;
  if (existing.includes("# Changelog")) {
    next = existing.replace("# Changelog", `# Changelog\n\n${newEntry}`);
  }
  else if (existing.includes("# CHANGELOG")) {
    next = existing.replace("# CHANGELOG", `# CHANGELOG\n\n${newEntry}`);
  }
  else {
    next = newEntry + existing;
  }

  fs.writeFileSync(changelogPath, next);
}

async function main(): Promise<void> {
  const workspaceRoot = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_TOKEN;
  const model = process.env.ANTHROPIC_MODEL ?? "sonnet";

  if (!apiKey) {
    console.error(
      "Missing Anthropic credentials: set ANTHROPIC_API_KEY (CI) or ANTHROPIC_TOKEN (local)",
    );
    process.exit(1);
  }

  // Ensure the SDK can find credentials.
  // Claude Agent SDK reads ANTHROPIC_API_KEY, so map token if provided.
  if (!process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_TOKEN) {
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_TOKEN;
  }

  const ci = getCiContextFromEnv();

  let version: string;
  let prevTag: string;
  let commits: string;
  let stats: string;

  if (isRunningInGitHubActions()) {
    if (!ci.version || ci.prevTag === undefined || !ci.commits || !ci.stats) {
      throw new Error(
        "CI mode requires VERSION, PREV_TAG, COMMITS, and STATS to be set in the environment.",
      );
    }
    version = ci.version;
    prevTag = ci.prevTag;
    commits = ci.commits;
    stats = ci.stats;
  }
  else {
    // Local mode: compute everything from git.
    const prevTagRaw = runGit(["describe", "--tags", "--abbrev=0"]);
    const next = computeNextVersion(prevTagRaw);
    version = next.version;
    prevTag = next.prevTagRaw;
    const built = buildContext(prevTag);
    commits = built.commits;
    stats = built.stats;
  }

  const prompt = fillPromptTemplate({
    workspaceRoot,
    version,
    prevTag,
    commits,
    stats,
  });

  console.log(
    `Generating release notes with Claude Agent SDK (model=${model})...`,
  );

  const result = await unstable_v2_prompt(prompt, { model });
  if (result.subtype !== "success") {
    throw new Error(`Release notes generation failed: ${result.subtype}`);
  }

  const content = result.result;
  fs.writeFileSync("RELEASE_NOTES.md", content);
  updateChangelog({ version, content });

  console.log("RELEASE_NOTES.md written.");
  console.log("CHANGELOG.md updated.");
  console.log(`Estimated cost: $${result.total_cost_usd.toFixed(4)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
