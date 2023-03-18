import fs from "fs";
import path from "path";

let PROGRAM_FILES_ROOT = "";

process.argv.find((val, index) => {
  const splitVal = val.split("=");
  if (
    splitVal.length > 1 &&
    splitVal[0].trim() === "--appDir" &&
    splitVal[1].length > 0
  ) {
    PROGRAM_FILES_ROOT = splitVal[1];
    return true;
  }
});

export const APP_DIR = path.resolve(PROGRAM_FILES_ROOT, "PashaPlayerFiles");
export const CACHE_PATH = path.resolve(APP_DIR, "cache");
export const STAGING_PATH = path.resolve(CACHE_PATH, "staging");
export const DB_PATH = path.resolve(APP_DIR, "cache.db");

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
