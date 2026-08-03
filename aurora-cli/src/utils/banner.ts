import {
  AURORA_CLI_VERSION,
} from "../core/packageMetadata.js";

export function getBannerText():
  string {
  return `
═══════════════════════════════════════
          Aurora CLI v${AURORA_CLI_VERSION}
═══════════════════════════════════════

The command center for Aurora.

Ready.
`;
}

export function showBanner(): void {
  console.clear();

  console.log(
    getBannerText()
  );
}