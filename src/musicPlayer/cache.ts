import fs from "fs";
import path from "path";
import sqlite3 from "sqlite3";

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

const APP_DIR = path.resolve(PROGRAM_FILES_ROOT, "PashaPlayerFiles");
const CACHE_PATH = path.resolve(APP_DIR, "cache");
const STAGING_PATH = path.resolve(CACHE_PATH, "staging");
const DB_PATH = path.resolve(APP_DIR, "cache.db");

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

const db = new sqlite3.Database(DB_PATH);
db.run(
  "CREATE TABLE IF NOT EXISTS video_info (video_id TEXT PRIMARY KEY, info TEXT, insertion_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL)"
);

export { db, CACHE_PATH, STAGING_PATH };
