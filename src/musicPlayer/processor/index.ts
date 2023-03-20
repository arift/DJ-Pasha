import { fork } from "node:child_process";
import { CACHE_PATH, DB_PATH, STAGING_PATH } from "../paths";
import {
  ProcessArgs,
  _getInfo,
  _getInfos,
  _getPlaylistInfo,
  _getPlayStatsArgs,
  _getSong,
  _getTopPlayers,
} from "./processor";

const processReq = async <T>(args: ProcessArgs) => {
  return await new Promise<T>((res, rej) => {
    const compute = fork("build/musicPlayer/processor/processor", [
      `--parentContext=${JSON.stringify({
        cachePath: CACHE_PATH,
        stagingPath: STAGING_PATH,
        dbPath: DB_PATH,
      })}`,
    ]);
    compute.on("message", (result: any) => {
      res(JSON.parse(result));
      compute.kill();
    });
    compute.on("error", (err) => {
      rej(err);
      compute.kill();
    });
    compute.send(JSON.stringify(args));
  });
};

export const getInfo = async (...args: Parameters<typeof _getInfo>) => {
  return await processReq<ReturnType<typeof _getInfo>>({
    kind: "getInfo",
    videoId: args[0],
  });
};

export const getInfos = async (...args: Parameters<typeof _getInfos>) => {
  return await processReq<ReturnType<typeof _getInfos>>({
    kind: "getInfos",
    videoIds: args[0],
  });
};

export const getPlaylistInfo = async (
  ...args: Parameters<typeof _getPlaylistInfo>
) => {
  return await processReq<ReturnType<typeof _getPlaylistInfo>>({
    kind: "getPlaylistInfo",
    playlistId: args[0],
  });
};

export const getSong = async (...args: Parameters<typeof _getSong>) => {
  return await processReq<ReturnType<typeof _getSong>>({
    kind: "getSong",
    videoId: args[0],
  });
};

export const getPlayStatsArgs = async (
  ...args: Parameters<typeof _getPlayStatsArgs>
) => {
  return await processReq<ReturnType<typeof _getPlayStatsArgs>>({
    kind: "getPlayStats",
    days: args[0],
  });
};

export const getTopPlayers = async (
  ...args: Parameters<typeof _getTopPlayers>
) => {
  return await processReq<ReturnType<typeof _getTopPlayers>>({
    kind: "getTopPlayers",
    days: args[0],
  });
};
