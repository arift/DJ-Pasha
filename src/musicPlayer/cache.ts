import fs from "fs";
import os from "os";
import sqlite3 from "sqlite3";

let CACHE_ROOT = os.tmpdir();

process.argv.find((val, index) => {
  const splitVal = val.split("=");
  if (
    splitVal.length > 1 &&
    splitVal[0].trim() === "--cache" &&
    splitVal[1].length > 0
  ) {
    CACHE_ROOT = splitVal[1].trim();
  }
});

const APP_DIR = `${CACHE_ROOT}/PashaPlayer`;
const CACHE_PATH = `${APP_DIR}/cache`;
const STAGING_PATH = `${CACHE_PATH}/staging`;
const DB_PATH = `${CACHE_PATH}/cache.db`;

if (!fs.existsSync(CACHE_ROOT)) {
  fs.mkdirSync(CACHE_ROOT);
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
