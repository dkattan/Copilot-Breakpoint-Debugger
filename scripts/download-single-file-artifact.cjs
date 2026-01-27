/*
 * Download a single GitHub Actions artifact and optionally verify its SHA-256.
 *
 * This uses the dkattan/toolkit fork build output of @actions/artifact.
 *
 * Env vars:
 *   SINGLE_ARTIFACT_NAME            (required) artifact name
 *   SINGLE_ARTIFACT_DOWNLOAD_DIR    (required) destination directory
 *   SINGLE_ARTIFACT_EXPECTED_SHA256 (optional) expected SHA-256 hex
 *   SINGLE_ARTIFACT_DEBUG_ENV       (optional) '1' to print partial ACTIONS_RUNTIME_* env vars
 */

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const process = require("node:process");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function formatPartialSecret(value) {
  if (!value) {
    return "<unset>";
  }

  const s = String(value);
  const len = s.length;
  if (len <= 12) {
    return `${s.slice(0, 2)}…${s.slice(-2)} (len=${len})`;
  }

  return `${s.slice(0, 6)}…${s.slice(-6)} (len=${len})`;
}

function maybePrintRuntimeEnvDebug() {
  if (process.env.SINGLE_ARTIFACT_DEBUG_ENV !== "1") {
    return;
  }

  console.log(
    `ACTIONS_RUNTIME_TOKEN=${formatPartialSecret(process.env.ACTIONS_RUNTIME_TOKEN)}`,
  );
  console.log(
    `ACTIONS_RUNTIME_URL=${formatPartialSecret(process.env.ACTIONS_RUNTIME_URL)}`,
  );
  console.log(
    `ACTIONS_RESULTS_URL=${formatPartialSecret(process.env.ACTIONS_RESULTS_URL)}`,
  );
}

function parseArtifactId(value) {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Invalid artifact id number: ${String(value)}`);
    }
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new Error(`Invalid artifact id string: '${value}'`);
    }
    const num = Number(trimmed);
    if (!Number.isSafeInteger(num) || num <= 0) {
      // Use BigInt if it doesn't fit safely into a JS number.
      return BigInt(trimmed);
    }
    return num;
  }
  throw new TypeError(`Unrecognized artifact id type: ${typeof value}`);
}

async function sha256FileHex(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function downloadSingleFileArtifact() {
  maybePrintRuntimeEnvDebug();

  const artifactName = process.env.SINGLE_ARTIFACT_NAME;
  const downloadDir = process.env.SINGLE_ARTIFACT_DOWNLOAD_DIR;
  const expectedSha256 = process.env.SINGLE_ARTIFACT_EXPECTED_SHA256;

  if (!artifactName) {
    throw new Error("Missing env var SINGLE_ARTIFACT_NAME");
  }
  if (!downloadDir) {
    throw new Error("Missing env var SINGLE_ARTIFACT_DOWNLOAD_DIR");
  }

  const downloadDirAbs = path.resolve(downloadDir);
  fs.mkdirSync(downloadDirAbs, { recursive: true });

  const artifactModulePath = path.resolve(
    __dirname,
    "../external/toolkit/packages/artifact/lib/artifact.js",
  );

  let DefaultArtifactClient;
  try {
    ({ DefaultArtifactClient } = require(artifactModulePath));
  }
  catch (error) {
    const originalErrorMessage = error && error.message ? error.message : String(error);
    throw new Error(
      [
        `Unable to load dkattan/toolkit @actions/artifact build output at ${artifactModulePath}.`,
        "Ensure the submodule is initialized and built (external/toolkit: npm install && npm run bootstrap && npm run build).",
        `Original error: ${originalErrorMessage}`,
      ].join(" "),
    );
  }

  const client = new DefaultArtifactClient();

  if (typeof client.getArtifact !== "function") {
    throw new TypeError(
      "DefaultArtifactClient.getArtifact(name) is not available; cannot resolve artifact name to id for download.",
    );
  }

  const getRes = await client.getArtifact(artifactName);
  const artifact = (getRes && getRes.artifact) ? getRes.artifact : getRes;
  const artifactId = parseArtifactId(artifact && artifact.id);

  // Best-effort: print a clickable artifact link.
  const repo = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  if (repo && runId) {
    console.log(
      `Artifact URL: https://github.com/${repo}/actions/runs/${runId}/artifacts/${String(artifactId)}`,
    );
  }

  // downloadArtifact returns {downloadPath} in official @actions/artifact.
  // We'll accept either string or object to be tolerant to minor API differences.
  const res = await client.downloadArtifact(artifactId, downloadDirAbs);
  const downloadPath = typeof res === "string" ? res : res && res.downloadPath ? res.downloadPath : downloadDirAbs;

  // Find the single file we downloaded.
  const entries = fs.readdirSync(downloadPath, { withFileTypes: true });
  const files = entries.filter(e => e.isFile()).map(e => path.join(downloadPath, e.name));
  if (files.length === 0) {
    throw new Error(
      `Downloaded artifact '${artifactName}' to '${downloadPath}' but found no files.`,
    );
  }

  // If it's truly a single-file artifact, there should be exactly one.
  // If not, we'll still hash the first file and warn.
  if (files.length !== 1) {
    console.warn(
      `::warning::Expected a single file in downloaded artifact '${artifactName}', but found ${files.length}. Using the first file for hash verification: ${files[0]}`,
    );
  }

  const fileToHash = files[0];
  const actualSha256 = await sha256FileHex(fileToHash);

  console.log(`Downloaded artifact '${artifactName}' to: ${downloadPath}`);
  console.log(`Downloaded file: ${path.basename(fileToHash)} (${fileToHash})`);
  console.log(`SHA256(downloaded)=${actualSha256}`);

  if (expectedSha256) {
    if (actualSha256.toLowerCase() !== String(expectedSha256).trim().toLowerCase()) {
      throw new Error(
        `SHA-256 mismatch for '${artifactName}': expected ${expectedSha256}, got ${actualSha256}`,
      );
    }
    console.log("SHA-256 matches expected.");
  }

  return { downloadPath, file: fileToHash, sha256: actualSha256 };
}

module.exports = {
  downloadSingleFileArtifact,
};

if (require.main === module) {
  downloadSingleFileArtifact().catch((error) => {
    fail(error && error.stack ? error.stack : String(error));
  });
}
