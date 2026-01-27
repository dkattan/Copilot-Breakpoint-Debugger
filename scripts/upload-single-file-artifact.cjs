/*
 * Upload a single file as a GitHub Actions artifact without zipping.
 *
 * This uses the dkattan/toolkit fork of @actions/artifact, which adds:
 *   uploadArtifact(..., { zip: false })
 *
 * Intended for workflows that want a "single file" artifact (e.g. demo.mp4)
 * without the zip/wrapper step.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const process = require("node:process");

function fail(message) {
  console.error(message);
  process.exit(1);
}

const artifactName = process.env.SINGLE_ARTIFACT_NAME;
const artifactFile = process.env.SINGLE_ARTIFACT_FILE;

if (!artifactName) {
  fail("Missing env var SINGLE_ARTIFACT_NAME");
}

if (!artifactFile) {
  fail("Missing env var SINGLE_ARTIFACT_FILE");
}

const artifactFileAbs = path.resolve(artifactFile);
if (!fs.existsSync(artifactFileAbs)) {
  console.warn(
    `::warning::Single-file artifact upload skipped; file not found: ${artifactFileAbs}`,
  );
  process.exit(0);
}

const retentionDaysRaw = process.env.SINGLE_ARTIFACT_RETENTION_DAYS;
const retentionDays = retentionDaysRaw ? Number(retentionDaysRaw) : undefined;
if (retentionDaysRaw && (!Number.isFinite(retentionDays) || retentionDays <= 0)) {
  fail(
    `Invalid SINGLE_ARTIFACT_RETENTION_DAYS='${retentionDaysRaw}' (expected a positive number)`,
  );
}

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
  fail(
    [
      `Unable to load dkattan/toolkit @actions/artifact build output at ${artifactModulePath}.`,
      "Ensure the submodule is initialized and built (external/toolkit: npm install && npm run bootstrap && npm run build).",
      `Original error: ${originalErrorMessage}`,
    ].join(" "),
  );
}

if (typeof DefaultArtifactClient !== "function") {
  fail(
    `dkattan/toolkit artifact module did not export DefaultArtifactClient (path: ${artifactModulePath})`,
  );
}

async function main() {
  const rootDirectory = path.dirname(artifactFileAbs);

  // NOTE: zip:false is a fork-only option.
  const options = {
    zip: false,
    ...(retentionDays ? { retentionDays } : {}),
  };

  const client = new DefaultArtifactClient();
  const res = await client.uploadArtifact(
    artifactName,
    [artifactFileAbs],
    rootDirectory,
    options,
  );

  const id = res && typeof res.id !== "undefined" ? String(res.id) : "<unknown>";
  const digest = res && res.digest ? String(res.digest) : "<unknown>";
  const size = res && typeof res.size !== "undefined" ? String(res.size) : "<unknown>";

  console.log(
    `Uploaded single-file artifact '${artifactName}': id=${id} size=${size} digest=${digest}`,
  );
}

main().catch((error) => {
  fail(error && error.stack ? error.stack : String(error));
});
