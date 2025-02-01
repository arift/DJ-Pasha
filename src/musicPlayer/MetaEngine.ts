import ytdl from "@distube/ytdl-core";
import { format, formatISO } from "date-fns";
import fs from "node:fs";
import path from "node:path";
import ytpl from "ytpl";
import { cookie } from "../args";
import { Database, getDb } from "./db";
import { CACHE_PATH, DB_FILE_PATH, STAGING_PATH } from "./paths";
import { SavedInfo } from "./types";
import { rjust } from "./utils";

export class MetaEngine {
  #db: Database;
  #cacheDir: string;
  #stagingDir: string;

  constructor(args: { cacheDir: string, stagingDir: string, dbDir: string }) {
    this.#cacheDir = args.cacheDir;
    this.#stagingDir = args.stagingDir;
    this.#db = getDb(args.dbDir);
    this.#db.run(`
      CREATE TABLE IF NOT EXISTS video_info (
      video_id TEXT PRIMARY KEY, 
      info TEXT, 
      insertion_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`);

    this.#db.run(`
      CREATE TABLE IF NOT EXISTS plays (
      video_id TEXT, 
      username TEXT, 
      play_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
      PRIMARY KEY (video_id, username, play_timestamp)
    )`);
  }

  getInfo = async (videoId: string): Promise<SavedInfo> => {
    const row = await this.#db.getAsync(
      "select * from video_info where video_id = $videoId",
      {
        $videoId: videoId,
      }
    );
    if (row) {
      return JSON.parse(row.info) as SavedInfo;
    }

    console.log(`Fetching video info: ${videoId}`);
    let info: ytdl.videoInfo;
    try {
      info = await ytdl.getInfo(videoId, {
        requestOptions: {
          headers: {
            cookie: cookie ?? "",
          },
        },
      });
    } catch (err) {
      console.error("Error while fetching video: ", err);
      return {
        title: "Error",
        ownerChannelName: "",
        description: "",
        lengthSeconds: "0",
        videoUrl: videoId,
      };
    }

    const savedInfo: SavedInfo = {
      title: info.videoDetails.title,
      ownerChannelName: info.videoDetails.ownerChannelName,
      description: info.videoDetails.description ?? "",
      lengthSeconds: info.videoDetails.lengthSeconds,
      videoUrl: info.videoDetails.video_url,
    };

    await this.#db.runAsync(
      "INSERT OR REPLACE INTO video_info (video_id, info) VALUES($videoId, $info)",
      { $videoId: videoId, $info: JSON.stringify(savedInfo) }
    );
    await this.#db.runAsync("commit");

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
    let playlistInfo: ytpl.Result | null = null;
    try {
      playlistInfo = await ytpl(playlistId, {
        requestOptions: {
          headers: {
            cookie: cookie ?? "",
          },
        },
      });
    } catch (err) {
      console.error("Error while fetching playlist: ", err);
      return null;
    }

    let itemsQueryValues: string[] = [];
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
      this.#db.runAsync(
        "INSERT OR REPLACE INTO video_info (video_id, info) VALUES " +
        playlistInfo.items.map(() => "(?, ?)").join(", "),
        itemsQueryValues
      );
      this.#db.runAsync("commit");
    } catch (err) {
      console.log("Err", err);
    }

    return playlistInfo;
  };

  getSong = async (videoId: string) => {
    return new Promise<string | null>((res, rej) => {
      const t = Date.now();
      const cachedFilePath = path.resolve(this.#cacheDir, videoId);

      if (fs.existsSync(cachedFilePath)) {
        console.log(`Song in cache: [${videoId}]`);
        res(cachedFilePath);
        return;
      }

      console.log(`Song not in cache, downloading it: [${videoId}]`);
      const stagingFilePath = path.resolve(this.#stagingDir, videoId);
      const ytStream = ytdl(videoId, {
        filter: "audioonly",
        quality: "highestaudio",
        requestOptions: {
          headers: {
            cookie: cookie ?? "",
          },
        },
      });
      const writeStream = fs.createWriteStream(stagingFilePath) as unknown as NodeJS.WritableStream;
      ytStream.pipe(writeStream);
      ytStream.on("error", (err) => {
        console.log("Error while downloading song", err);
        res(null);
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

  getPlayStatsPerPlayer = async (
    startDate?: Date,
    endDate?: Date,
    limit = 5
  ) => {
    let whereClause = "";
    if (startDate) {
      whereClause +=
        "DATETIME(play_timestamp, 'localtime') >= DATE($startDate)";
      if (endDate) {
        whereClause +=
          " AND DATETIME(play_timestamp, 'localtime') <= DATE($endDate)";
      }
    } else if (endDate) {
      whereClause += "DATETIME(play_timestamp, 'localtime') <= $endDate";
    }

    const query = `SELECT username, count(*) play_count 
      FROM plays 
      ${whereClause ? `WHERE ${whereClause}` : ""}
      GROUP BY username 
      ORDER BY play_count desc 
      LIMIT $limit
    `;
    const params = {
      $limit: limit,
    };
    if (startDate) {
      params["$startDate"] = formatISO(startDate);
    }
    if (endDate) {
      params["$endDate"] = formatISO(endDate);
    }
    const rows = (await this.#db.allAsync(query, params)) as Array<{
      username: string;
      play_count: number;
    }>;

    return rows.map((row) => ({
      username: row.username,
      playCount: row.play_count,
    }));
  };

  generatePlayStatsText = async (startDate?: Date, endDate?: Date) => {
    const stats = await this.getPlayStatsPerPlayer(startDate, endDate, 5);
    const startDateFormatted = startDate
      ? format(startDate, "MM/dd/yyyy")
      : null;
    const endDateFormatted = endDate ? format(endDate, "MM/dd/yyyy") : null;

    let result = `Here are the top bogarters`;
    if (startDateFormatted) {
      result += ` from ${startDateFormatted}`;
      if (endDateFormatted) {
        result += ` to ${endDateFormatted}`;
      } else {
        result += ` and on`;
      }
    } else if (endDateFormatted) {
      result += ` until ${endDateFormatted}`;
    } else {
      result += ` of all time`;
    }
    result += ":\n";

    result += stats
      .map((stat, idx) => {
        let emoji: string;
        switch (idx) {
          case 0:
            emoji = ":first_place:";
            break;
          case 1:
            emoji = ":second_place:";
            break;
          case 2:
            emoji = ":third_place:";
            break;
          case 3:
            emoji = "4)";
            break;
          case 4:
            emoji = "5)";
            break;
          default:
            emoji = "";
            break;
        }
        return `${emoji} ${stat.username}: ${stat.playCount}`;
      })
      .join("\n");

    result += `\n${this.generateChartStatsText(stats)}`;

    return result;
  };

  generateChartStatsText = (
    stats: Awaited<ReturnType<MetaEngine["getPlayStatsPerPlayer"]>>
  ) => {
    const maxValue = Math.max(...stats.map((stat) => stat.playCount));
    const increment = maxValue / 25;
    const longestLabelLength = Math.max(
      ...stats.map((stat) => stat.username.length)
    );
    const longestPlayCountLength = Math.max(
      ...stats.map((stat) => stat.playCount.toString().length)
    );

    let result: string[] = [];
    stats.forEach((stat) => {
      const playCount = stat.playCount;
      const barChunks = Math.floor(Math.floor((playCount * 8) / increment) / 8);
      const remainder = Math.floor((playCount * 8) / increment) % 8;
      // First draw the full width chunks
      let bar = "";
      for (let i = 0; i < barChunks; i++) {
        bar += "█";
      }

      // If the bar is empty, add a left one-eighth block
      if (bar.length === 0) {
        bar = "▏";
      }
      const paddedName = rjust(stat.username, longestLabelLength);
      const paddedNum = rjust(
        stat.playCount.toString(),
        longestPlayCountLength
      );
      result.push(`${paddedName} ▏${paddedNum} ${bar}`);
    });
    return `\`\n${result.join("\n")}\``;
  };

  insertNewPlay = async (videoId: string, username: string) => {
    console.log(`Adding new stat for video ${videoId} and user ${username}`);
    await this.#db.runAsync(
      `
        INSERT OR IGNORE INTO plays (video_id, username)
        VALUES ($videoId, $username)
      `,
      {
        $videoId: videoId,
        $username: username,
      }
    );
    await this.#db.runAsync("commit");
  };
}

const metaEngine = new MetaEngine({
  cacheDir: CACHE_PATH,
  stagingDir: STAGING_PATH,
  dbDir: DB_FILE_PATH,
})

export default metaEngine;