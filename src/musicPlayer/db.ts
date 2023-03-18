import sqlite3, { Database as SQLiteDatabase } from "sqlite3";
import { DB_PATH } from "./paths";

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

db.run(`
  CREATE TABLE IF NOT EXISTS video_info (
    video_id TEXT PRIMARY KEY, 
    info TEXT, 
    insertion_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`);
db.run(`
  CREATE TABLE IF NOT EXISTS plays (
    video_id TEXT, 
    username TEXT, 
    play_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    PRIMARY KEY (video_id, username, play_timestamp)
  )`);

export default db;
