import Constants from "expo-constants";

type Extra = {
  appVersion?: string;
  gitCommit?: string;
  buildLabel?: string;
};

function extra(): Extra {
  return (Constants.expoConfig?.extra ?? {}) as Extra;
}

/** App store / package version from app.json (e.g. "1.0.0"). */
export function getAppVersion(): string {
  return (
    extra().appVersion ||
    Constants.expoConfig?.version ||
    Constants.nativeAppVersion ||
    "0.0.0"
  );
}

/** Short git SHA baked in at Metro/EAS build time (e.g. "3665376"). */
export function getGitCommitShort(): string {
  const fromExtra = String(extra().gitCommit || "").trim();
  if (fromExtra) return fromExtra.slice(0, 7);
  return "unknown";
}

/** Human-readable label: "v1.0.0 · 3665376" */
export function getAppBuildLabel(): string {
  const baked = String(extra().buildLabel || "").trim();
  if (baked) return baked;
  return `v${getAppVersion()} · ${getGitCommitShort()}`;
}
