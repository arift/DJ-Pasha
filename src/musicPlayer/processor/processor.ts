import fs from "node:fs";
import path from "node:path";
import ytdl from "ytdl-core";
import ytpl from "ytpl";
import { Database, getDb } from "../db";
import { SavedInfo } from "../types";
import { getArgv } from "../utils";

const kinds = [
  "getInfo",
  "getInfos",
  "getPlaylistInfo",
  "getSong",
  "getPlayStats",
  "getTopPlayers",
] as const;

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

type ProcessPlayStatsArgs = {
  kind: (typeof kinds)[4] | (typeof kinds)[5];
  days: number;
};

export type ProcessArgs =
  | ProcessInfoArgs
  | ProcessInfosArgs
  | ProcessPlaylistInfoArgs
  | ProcessSongArgs
  | ProcessPlayStatsArgs;

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
    case kinds[0]:
      process.send(JSON.stringify(await _getInfo(msg.videoId)));
      break;

    case kinds[1]:
      process.send(JSON.stringify(await _getInfos(msg.videoIds)));
      break;

    case kinds[2]:
      process.send(JSON.stringify(await _getPlaylistInfo(msg.playlistId)));
      break;

    case kinds[3]:
      process.send(JSON.stringify(await _getSong(msg.videoId)));
      break;

    case kinds[4]:
      process.send(JSON.stringify(await _getPlayStatsArgs(msg.days)));
      break;

    case kinds[5]:
      process.send(JSON.stringify(await _getTopPlayers(msg.days)));
      break;
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
  await db.runSync("commit");

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

export const _getPlayStatsArgs = async (days?: number) => {
  const rows = (await db.allSync(
    `
    SELECT plays.username, video_info.info, count(*) play_count 
    FROM plays 
    LEFT JOIN video_info on plays.video_id = video_info.video_id 
    ${
      days
        ? `WHERE plays.play_timestamp > DATETIME('now', '-${days} day') `
        : ``
    } 
    GROUP BY plays.video_id, plays.username 
    ORDER BY play_count desc 
    LIMIT 5
    ;
  `
  )) as Array<any>;
  return rows
    .filter((row) => row.info)
    .map((row: any) => ({
      username: row.username as string,
      info: JSON.parse(row.info) as SavedInfo,
      playCount: Number(row.play_count),
    }));
};

export const _getTopPlayers = async (days?: number) => {
  const rows = (await db.allSync(
    `
    SELECT username, count(*) play_count
    FROM plays 
    ${
      days
        ? `WHERE plays.play_timestamp > DATETIME('now', '-${days} day') `
        : ``
    } 
    GROUP BY username
    ORDER BY play_count desc
    LIMIT 5
  `
  )) as Array<any>;
  return rows.map((row: any) => ({
    username: row.username as string,
    playCount: Number(row.play_count),
  }));
};
