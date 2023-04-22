import fs from "fs";
import path from "path";
import { getArgv } from "./utils";

let PROGRAM_FILES_ROOT = getArgv("--appDir") ?? "";

export const APP_DIR = path.resolve(PROGRAM_FILES_ROOT, "PashaPlayerFiles");
export const CACHE_PATH = path.resolve(APP_DIR, "cache");
export const STAGING_PATH = path.resolve(CACHE_PATH, "staging");
export const DB_PATH = path.resolve("app.db");

console.log(`Setting app directory to ${APP_DIR}`);

if (PROGRAM_FILES_ROOT.length > 0 && !fs.existsSync(PROGRAM_FILES_ROOT)) {
  fs.mkdirSync(PROGRAM_FILES_ROOT);
}

if (!fs.existsSync(APP_DIR)) {
  fs.mkdirSync(APP_DIR);
}

if (!fs.existsSync(CACHE_PATH)) {
  fs.mkdirSync(CACHE_PATH);
}

if (!fs.existsSync(STAGING_PATH)) {
  fs.mkdirSync(STAGING_PATH);
}
