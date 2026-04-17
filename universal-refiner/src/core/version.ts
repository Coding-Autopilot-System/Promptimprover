import { PACKAGE_VERSION } from "./generated-version.js";

export function getPackageVersion(): string {
  return PACKAGE_VERSION;
}

export function getDisplayVersion(): string {
  return `v${PACKAGE_VERSION}`;
}
