import { fork } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ytdl from "ytdl-core";
import db from "./db";
import { CACHE_PATH, STAGING_PATH } from "./paths";
import { SavedInfo } from "./types";
import { random } from "./utils";

const types = ["GET_INFO", "GET_INFOS", "GET_SONG"] as const;

export type ProcessInfoArgs = {
  kind: (typeof types)[0];
  videoId: string;
};

export type ProcessInfosArgs = {
  kind: (typeof types)[1];
  videoIds: Array<string>;
};

export type ProcessSongArgs = {
  kind: (typeof types)[2];
  videoId: string;
};

export type Args = ProcessInfoArgs | ProcessInfosArgs | ProcessSongArgs;

process.on("message", async (msgString: string) => {
  const msg = JSON.parse(msgString) as Args;

  if (!msg.kind) {
    console.log(
      "Recevieved a message with no type. Ignoring it. Message: " + msgString
    );
    return;
  }

  switch (msg.kind) {
    case "GET_INFO":
      process.send(JSON.stringify(await getInfo(msg.videoId)));
      return;

    case "GET_INFOS":
      process.send(JSON.stringify(await getInfos(msg.videoIds)));
      return;
    case "GET_SONG":
      process.send(JSON.stringify(await getSong(msg.videoId)));
      return;
  }
});

const getInfo = async (videoId: string) => {
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

const getInfos = async (videoIds: Array<string>) => {
  const result: Array<SavedInfo> = [];
  for (let idx = 0; idx < videoIds.length; idx++) {
    result.push(await getInfo(videoIds[idx]));
    await new Promise((res) => setTimeout(res, random(0, 500)));
  }
  return result;
};

const getSong = async (videoId: string) => {
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

export const processReq = async <
  T extends SavedInfo | string | Array<SavedInfo>
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
