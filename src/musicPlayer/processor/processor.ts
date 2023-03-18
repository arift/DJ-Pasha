import fs from "node:fs";
import path from "node:path";
import ytdl from "ytdl-core";
import ytpl from "ytpl";
import { Database, getDb } from "../db";
import { SavedInfo } from "../types";
import { getArgv } from "../utils";

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

export type ProcessArgs =
  | ProcessInfoArgs
  | ProcessInfosArgs
  | ProcessPlaylistInfoArgs
  | ProcessSongArgs;

export type ParentContext = {
  cachePath: string;
  stagingPath: string;
  dbPath: string;
};

let parentContext: ParentContext;
let db: Database;

process.on("message", async (msgString: string) => {
  const msg = JSON.parse(msgString) as ProcessArgs;
  const parentContextString = getArgv("--parentContext");
  if (!parentContextString) {
    throw new Error("Missing parent context");
  }

  parentContext = JSON.parse(parentContextString) as ParentContext;
  db = getDb(parentContext.dbPath);

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

export const _getInfo = async (videoId: string) => {
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

export const _getInfos = async (videoIds: Array<string>) => {
  console.log(`Getting multiple infos for ${videoIds.length} items`);
  const result: Array<SavedInfo> = [];
  for (let idx = 0; idx < videoIds.length; idx++) {
    result.push(await _getInfo(videoIds[idx]));
  }
  return result;
};

export const _getPlaylistInfo = async (playlistId: string) => {
  return await ytpl(playlistId, {
    requestOptions: {
      headers: {
        cookie: process.env.COOKIE,
      },
    },
  });
};

export const _getSong = async (videoId: string) => {
  return new Promise<string>((res, rej) => {
    const t = Date.now();
    const cachedFilePath = path.resolve(parentContext.cachePath, videoId);

    if (fs.existsSync(cachedFilePath)) {
      res(cachedFilePath);
      return;
    }

    console.log(`Song not in cache, downloading it: [${videoId}]`);
    const stagingFilePath = path.resolve(parentContext.stagingPath, videoId);
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
