import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const source = path.join(projectRoot, "src", "core", "dashboard.html");
const destination = path.join(projectRoot, "dist", "src", "core", "dashboard.html");

fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.copyFileSync(source, destination);