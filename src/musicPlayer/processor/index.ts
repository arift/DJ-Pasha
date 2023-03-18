import { fork } from "node:child_process";
import ytpl from "ytpl";
import { CACHE_PATH, DB_PATH, STAGING_PATH } from "../paths";
import { SavedInfo } from "../types";
import {
  ProcessArgs,
  _getInfo,
  _getInfos,
  _getPlaylistInfo,
  _getSong,
} from "./processor";

const processReq = async <
  T extends SavedInfo | string | Array<SavedInfo> | ytpl.Result
>(
  args: ProcessArgs
) => {
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
  return await (processReq({ kind: "getInfo", videoId: args[0] }) as ReturnType<
    typeof _getInfo
  >);
};

export const getInfos = async (...args: Parameters<typeof _getInfos>) => {
  return await (processReq({
    kind: "getInfos",
    videoIds: args[0],
  }) as ReturnType<typeof _getInfos>);
};

export const getPlaylistInfo = async (
  ...args: Parameters<typeof _getPlaylistInfo>
) => {
  return await (processReq({
    kind: "getPlaylistInfo",
    playlistId: args[0],
  }) as ReturnType<typeof _getPlaylistInfo>);
};

export const getSong = async (...args: Parameters<typeof _getSong>) => {
  return await (processReq({
    kind: "getSong",
    videoId: args[0],
  }) as ReturnType<typeof _getSong>);
};
