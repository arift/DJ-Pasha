import fs from "fs";
import path from "path";

const cacheDir = process.env.CACHE_DIR ?? './cache';
const dbDir = process.env.DB_DIR ?? './db';

export const CACHE_PATH = path.resolve(cacheDir);
export const STAGING_PATH = path.resolve(CACHE_PATH, "staging");
export const DB_FILE_PATH = path.resolve(dbDir, "app.db");

console.log(`Setting cache directory to ${CACHE_PATH}`);
console.log(`Setting db directory to ${DB_FILE_PATH}`);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir);
}

if (!fs.existsSync(CACHE_PATH)) {
  fs.mkdirSync(CACHE_PATH);
}

if (!fs.existsSync(STAGING_PATH)) {
  fs.mkdirSync(STAGING_PATH);
}
