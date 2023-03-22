import fs from "node:fs";
import path from "node:path";
import ytdl from "ytdl-core";
import ytpl from "ytpl";
import { Database, getDb } from "../db";
import { SavedInfo } from "../types";

export class MetaEngine {
  db: Database;
  cachePath: string;
  stagingPath: string;

  constructor(cachePath: string, stagingPath: string, dbPath: string) {
    this.cachePath = cachePath;
    this.stagingPath = stagingPath;
    this.db = getDb(dbPath);
  }

  getInfo = async (videoId: string) => {
    const row = await this.db.getSync(
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

    await this.db.runSync(
      "INSERT OR REPLACE INTO video_info (video_id, info) VALUES($videoId, $info)",
      { $videoId: videoId, $info: JSON.stringify(savedInfo) }
    );
    await this.db.runSync("commit");

    return savedInfo;
  };

  getInfos = async (videoIds: Array<string>) => {
    console.log(`Getting multiple infos for ${videoIds.length} items`);
    const result: Array<SavedInfo> = [];
    for (let idx = 0; idx < videoIds.length; idx++) {
      result.push(await this.getInfo(videoIds[idx]));
    }
    return result;
  };

  getPlaylistInfo = async (playlistId: string) => {
    //TODO insert play list songs info. its all there
    /**
     *  {
      title: 'Let Me Blow Ya Mind',
      index: 8,
      id: '5EPJgyX7rvI',
      shortUrl: 'https://www.youtube.com/watch?v=5EPJgyX7rvI',
      url: 'https://www.youtube.com/watch?v=5EPJgyX7rvI&list=PLli8P2WEwiaWe58IlqyDTugz57xs858GL&index=8',
      author: [Object],
      thumbnails: [Array],
      bestThumbnail: [Object],
      isLive: false,
      duration: '3:51',
      durationSec: 231,
      isPlayable: true
    },
     */
    const playlistInfo = await ytpl(playlistId, {
      requestOptions: {
        headers: {
          cookie: process.env.COOKIE,
        },
      },
    });
    let itemsQueryValues = [];
    playlistInfo.items.forEach((info) => {
      const savedInfo: SavedInfo = {
        title: info.title,
        ownerChannelName: info.author.name,
        description: "",
        lengthSeconds: String(info.durationSec),
        videoUrl: info.shortUrl,
      };
      itemsQueryValues.push(info.id);
      itemsQueryValues.push(JSON.stringify(savedInfo));
    });
    try {
      this.db.runSync(
        "INSERT OR REPLACE INTO video_info (video_id, info) VALUES " +
          playlistInfo.items.map(() => "(?, ?)").join(", "),
        itemsQueryValues
      );
      this.db.runSync("commit");
    } catch (err) {
      console.log("Err", err);
    }

    return playlistInfo;
  };

  getSong = async (videoId: string) => {
    return new Promise<string>((res, rej) => {
      const t = Date.now();
      const cachedFilePath = path.resolve(this.cachePath, videoId);

      if (fs.existsSync(cachedFilePath)) {
        res(cachedFilePath);
        return;
      }

      console.log(`Song not in cache, downloading it: [${videoId}]`);
      const stagingFilePath = path.resolve(this.stagingPath, videoId);
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

  getPlayStats = async (days?: number) => {
    const rows = (await this.db.allSync(
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

  getTopPlayers = async (days?: number) => {
    mySlowFunction(20000);
    const rows = (await this.db.allSync(
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
}

function mySlowFunction(blockTime: number) {
  console.time("mySlowFunction");
  let result = 0;
  let idx = 0;
  const now = performance.now();
  while (performance.now() - now < blockTime) {
    idx++;
    result += Math.atan(idx) * Math.tan(idx);
  }
  console.timeEnd(`mySlowFunction`);
}
