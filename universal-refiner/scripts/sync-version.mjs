import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const packageJsonPath = path.join(projectRoot, "package.json");
const outputPath = path.join(projectRoot, "src", "core", "generated-version.ts");

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
const version = packageJson.version || "0.0.0";
const content = `export const PACKAGE_VERSION = ${JSON.stringify(version)};\n`;

fs.writeFileSync(outputPath, content);
