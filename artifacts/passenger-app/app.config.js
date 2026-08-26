/**
 * Injects git commit + version into expo.extra so Profile can show which
 * binary/OTA is running (matches driver app AppBuildLabel pattern).
 */
const { execSync } = require("node:child_process");
const appJson = require("./app.json");

function shortGitCommit() {
  const fromEnv = (
    process.env.EAS_BUILD_GIT_COMMIT_HASH ||
    process.env.EXPO_PUBLIC_GIT_COMMIT ||
    process.env.GITHUB_SHA ||
    ""
  ).trim();
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .slice(0, 7);
  } catch {
    return "unknown";
  }
}

const gitCommit = shortGitCommit();
const expo = appJson.expo || {};

module.exports = {
  expo: {
    ...expo,
    extra: {
      ...(expo.extra || {}),
      appVersion: expo.version || "0.0.0",
      gitCommit,
      buildLabel: `v${expo.version || "0.0.0"} · ${gitCommit}`,
    },
  },
};
