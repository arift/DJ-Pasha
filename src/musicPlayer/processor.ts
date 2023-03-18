import { fork } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ytdl from "ytdl-core";
import ytpl from "ytpl";
import db from "./db";
import { CACHE_PATH, STAGING_PATH } from "./paths";
import { SavedInfo } from "./types";

const kinds = ["getInfo", "getInfos", "getPlaylistInfo", "getSong"] as const;

type ProcessInfoArgs = {
  kind: (typeof kinds)[0];
  videoId: string;
};

type ProcessInfosArgs = {
  kind: (typeof kinds)[1];
  videoIds: Array<string>;
};

type ProcessPlaylistInfoArgs = {
  kind: (typeof kinds)[2];
  playlistId: string;
};

type ProcessSongArgs = {
  kind: (typeof kinds)[3];
  videoId: string;
};

type Args =
  | ProcessInfoArgs
  | ProcessInfosArgs
  | ProcessPlaylistInfoArgs
  | ProcessSongArgs;

process.on("message", async (msgString: string) => {
  const msg = JSON.parse(msgString) as Args;

  if (!msg.kind) {
    console.log(
      "Recevieved a message with no type. Ignoring it. Message: " + msgString
    );
    return;
  }

  switch (msg.kind) {
    case "getInfo":
      process.send(JSON.stringify(await _getInfo(msg.videoId)));
      return;

    case "getInfos":
      process.send(JSON.stringify(await _getInfos(msg.videoIds)));
      return;

    case "getPlaylistInfo":
      process.send(JSON.stringify(await _getPlaylistInfo(msg.playlistId)));
      return;

    case "getSong":
      process.send(JSON.stringify(await _getSong(msg.videoId)));
      return;
  }
});

const _getInfo = async (videoId: string) => {
  const row = await db.getSync(
    "select * from video_info where video_id = $videoId",
    {
      $videoId: videoId,
    }
  );
  if (row) {
    return JSON.parse(row.info) as SavedInfo;
  }

  console.log(`Fetching video info: ${videoId}`);
  const info = await ytdl.getInfo(videoId, {
    requestOptions: {
      headers: {
        cookie: process.env.COOKIE,
      },
    },
  });

  const savedInfo: SavedInfo = {
    title: info.videoDetails.title,
    ownerChannelName: info.videoDetails.ownerChannelName,
    description: info.videoDetails.description,
    lengthSeconds: info.videoDetails.lengthSeconds,
    videoUrl: info.videoDetails.video_url,
  };

  await db.runSync(
    "INSERT OR REPLACE INTO video_info (video_id, info) VALUES($videoId, $info)",
    { $videoId: videoId, $info: JSON.stringify(savedInfo) }
  );

  return savedInfo;
};

const _getInfos = async (videoIds: Array<string>) => {
  console.log(`Getting multiple infos for ${videoIds.length} items`);
  const result: Array<SavedInfo> = [];
  for (let idx = 0; idx < videoIds.length; idx++) {
    result.push(await _getInfo(videoIds[idx]));
  }
  return result;
};

const _getPlaylistInfo = async (playlistId: string) => {
  return await ytpl(playlistId, {
    requestOptions: {
      headers: {
        cookie: process.env.COOKIE,
      },
    },
  });
};

const _getSong = async (videoId: string) => {
  return new Promise<string>((res, rej) => {
    const t = Date.now();
    const cachedFilePath = path.resolve(CACHE_PATH, videoId);

    if (fs.existsSync(cachedFilePath)) {
      res(cachedFilePath);
      return;
    }

    console.log(`Song not in cache, downloading it: [${videoId}]`);
    const stagingFilePath = path.resolve(STAGING_PATH, videoId);
    const ytStream = ytdl(videoId, {
      filter: "audioonly",
      quality: "highestaudio",
      requestOptions: {
        headers: {
          cookie: process.env.COOKIE,
        },
      },
    });
    ytStream.pipe(fs.createWriteStream(stagingFilePath));
    ytStream.on("error", (err) => {
      rej(err);
    });
    ytStream.on("end", () => {
      console.log(
        `Song downloaded it in ${(Date.now() - t) / 1000} seconds: ${videoId}`
      );
      if (!fs.existsSync(cachedFilePath) && fs.existsSync(stagingFilePath)) {
        fs.renameSync(stagingFilePath, cachedFilePath);
      }
      res(cachedFilePath);
    });
  });
};

const processReq = async <
  T extends SavedInfo | string | Array<SavedInfo> | ytpl.Result
>(
  args: Args
) => {
  return await new Promise<T>((res, rej) => {
    const compute = fork("build/musicPlayer/processor");
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
