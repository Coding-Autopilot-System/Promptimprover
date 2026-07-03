import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const isolationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-refiner-tests-"));
const projectRoot = path.join(isolationRoot, "project");

fs.mkdirSync(path.join(projectRoot, ".refiner"), { recursive: true });
process.env.PROMPT_REFINER_PROJECT_DIR = projectRoot;
process.env.PROMPT_REFINER_GLOBAL_DIR = path.join(isolationRoot, "global");
