import fs from "fs";
import path from "path";
import sqlite3, { Database as SQLiteDatabase } from "sqlite3";

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

export type Database = SQLiteDatabase & {
  runSync: (sql: string, params: any) => Promise<any>;
  getSync: (sql: string, params: any) => Promise<any>;
};

const db = new sqlite3.Database(DB_PATH) as Database;

(db as Database).runSync = (sql: string, params: any) =>
  new Promise<any>((res, rej) => {
    db.run(sql, params, (result, err) => {
      if (err) {
        rej(err);
        return;
      }
      res(result);
    });
  });

(db as Database).getSync = (sql: string, params: any) =>
  new Promise<any>((res, rej) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        rej(err);
        return;
      }
      res(row);
    });
  });

db.run(
  "CREATE TABLE IF NOT EXISTS video_info (video_id TEXT PRIMARY KEY, info TEXT, insertion_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL)"
);
db.run(`
  CREATE TABLE IF NOT EXISTS plays_info (
    video_id TEXT, 
    username TEXT, 
    play_count INTEGER, 
    last_play DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    PRIMARY KEY (video_id, username)
  )`);

export { db, CACHE_PATH, STAGING_PATH };
