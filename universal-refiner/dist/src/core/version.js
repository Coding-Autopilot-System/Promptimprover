import { PACKAGE_VERSION } from "./generated-version.js";
export function getPackageVersion() {
    return PACKAGE_VERSION;
}
export function getDisplayVersion() {
    return `v${PACKAGE_VERSION}`;
}
