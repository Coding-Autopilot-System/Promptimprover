import * as fs from "fs";
import * as os from "os";
import * as path from "path";
const LEVEL_ORDER = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};
function getGlobalDir() {
    return process.env.PROMPT_REFINER_GLOBAL_DIR || path.join(os.homedir(), ".refiner");
}
function getRuntimeLogPath() {
    return path.join(getGlobalDir(), "runtime.log");
}
function getConfiguredLevel() {
    const value = (process.env.PROMPT_REFINER_LOG_LEVEL || "info").toLowerCase();
    return value in LEVEL_ORDER ? value : "info";
}
function shouldLog(level) {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[getConfiguredLevel()];
}
function serializeMeta(meta) {
    if (meta === undefined) {
        return "";
    }
    if (meta instanceof Error) {
        return `${meta.name}: ${meta.message}\n${meta.stack || ""}`.trim();
    }
    if (typeof meta === "string") {
        return meta;
    }
    try {
        return JSON.stringify(meta);
    }
    catch {
        return String(meta);
    }
}
function write(level, message, meta) {
    const timestamp = new Date().toISOString();
    const renderedMeta = serializeMeta(meta);
    const line = `[${timestamp}] [${level.toUpperCase()}] ${message}${renderedMeta ? ` | ${renderedMeta}` : ""}`;
    try {
        fs.mkdirSync(getGlobalDir(), { recursive: true });
        fs.appendFileSync(getRuntimeLogPath(), line + os.EOL, "utf-8");
    }
    catch {
    }
    if (level === "error" || level === "warn") {
        console.error(line);
    }
    else {
        // We avoid console.log to prevent polluting stdout, which is reserved for JSON-RPC
        console.error(line);
    }
}
export class RuntimeLogger {
    static debug(message, meta) {
        if (shouldLog("debug")) {
            write("debug", message, meta);
        }
    }
    static info(message, meta) {
        if (shouldLog("info")) {
            write("info", message, meta);
        }
    }
    static warn(message, meta) {
        if (shouldLog("warn")) {
            write("warn", message, meta);
        }
    }
    static error(message, meta) {
        if (shouldLog("error")) {
            write("error", message, meta);
        }
    }
}
