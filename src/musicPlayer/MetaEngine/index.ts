import { cpus } from "node:os";
import { isMainThread, MessageChannel, Worker } from "node:worker_threads";
import { CACHE_PATH, DB_FILE_PATH, STAGING_PATH } from "../paths";
import { MetaEngine } from "./MetaEngine";

const numOfCpus = cpus().length;
const workerCount = Math.ceil(numOfCpus / 2);

const workers: Worker[] = [];
console.log(`Starting ${workerCount} workers`);

if (isMainThread) {
  for (let i = 0; i < workerCount; i++) {
    workers.push(
      new Worker(`${__dirname}/worker`, {
        workerData: {
          cachePath: CACHE_PATH,
          stagingPath: STAGING_PATH,
          dbPath: DB_FILE_PATH,
        },
      })
    );
  }
}

export const getInfo: MetaEngine["getInfo"] = (videoId) => {
  return doWork("getInfo", videoId);
};
export const getInfos: MetaEngine["getInfos"] = (args) => {
  return doWork("getInfos", args);
};
export const getPlaylistInfo: MetaEngine["getPlaylistInfo"] = (args) => {
  return doWork("getPlaylistInfo", args);
};
export const getSong: MetaEngine["getSong"] = (args) => {
  return doWork("getSong", args);
};
export const getPlayStats: MetaEngine["getPlayStatsPerPlayer"] = (args) => {
  return doWork("getPlayStats", args);
};
export const generatePlayStatsText: MetaEngine["generatePlayStatsText"] = (
  ...args
) => {
  return doWork("generatePlayStatsText", ...args);
};
export const insertNewPlay: MetaEngine["insertNewPlay"] = (...args) => {
  return doWork("insertNewPlay", ...args);
};

let roundRobinIdx = 0;
const doWork = <T>(kind: string, ...args: any) => {
  const { port1, port2 } = new MessageChannel();
  const promise = new Promise<T>((res) => {
    port2.on("message", res);
  });
  workers[roundRobinIdx++ % workers.length].postMessage(
    {
      port: port1,
      kind,
      args,
    },
    [port1]
  );

  return promise;
};
