import sqlite3, { Database as SQLiteDatabase } from "sqlite3";

export type Database = SQLiteDatabase & {
  runSync: (sql: string, params: any) => Promise<any>;
  getSync: (sql: string, params: any) => Promise<any>;
};

export const getDb = (path: string) => {
  const db = new sqlite3.Database(path) as Database;

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
  return db;
};
