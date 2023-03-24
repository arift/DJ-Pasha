import { format, formatISO } from "date-fns";
import fs from "node:fs";
import path from "node:path";
import ytdl from "ytdl-core";
import ytpl from "ytpl";
import { Database, getDb } from "../db";
import { SavedInfo } from "../types";

export class MetaEngine {
  #db: Database;
  #cachePath: string;
  #stagingPath: string;

  constructor(cachePath: string, stagingPath: string, dbPath: string) {
    this.#cachePath = cachePath;
    this.#stagingPath = stagingPath;
    this.#db = getDb(dbPath);
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

  getInfo = async (videoId: string) => {
    const row = await this.#db.getSync(
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

    await this.#db.runSync(
      "INSERT OR REPLACE INTO video_info (video_id, info) VALUES($videoId, $info)",
      { $videoId: videoId, $info: JSON.stringify(savedInfo) }
    );
    await this.#db.runSync("commit");

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
      this.#db.runSync(
        "INSERT OR REPLACE INTO video_info (video_id, info) VALUES " +
          playlistInfo.items.map(() => "(?, ?)").join(", "),
        itemsQueryValues
      );
      this.#db.runSync("commit");
    } catch (err) {
      console.log("Err", err);
    }

    return playlistInfo;
  };

  getSong = async (videoId: string) => {
    return new Promise<string>((res, rej) => {
      const t = Date.now();
      const cachedFilePath = path.resolve(this.#cachePath, videoId);

      if (fs.existsSync(cachedFilePath)) {
        res(cachedFilePath);
        return;
      }

      console.log(`Song not in cache, downloading it: [${videoId}]`);
      const stagingFilePath = path.resolve(this.#stagingPath, videoId);
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
    const rows = (await this.#db.allSync(query, params)) as Array<{
      username: string;
      play_count: number;
    }>;

    return rows.map((row) => ({
      username: row.username,
      playCount: row.play_count,
    }));
  };

  generatePlayStatsText = async (startDate?: Date, endDate?: Date) => {
    const stats = await this.getPlayStatsPerPlayer(startDate, endDate, 3);
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
      result += ` of all time.`;
    }
    result += ":\n";

    result += stats
      .slice(0, 3)
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
          default:
            emoji = "";
            break;
        }
        return `${emoji} ${stat.username}: ${stat.playCount}`;
      })
      .join("\n");

    return result;
  };

  insertNewPlay = async (videoId: string, username: string) => {
    console.log(`Adding new stat for video ${videoId} and user ${username}`);
    await this.#db.runSync(
      `
        INSERT OR IGNORE INTO plays (video_id, username)
        VALUES ($videoId, $username)
      `,
      {
        $videoId: videoId,
        $username: username,
      }
    );
    await this.#db.runSync("commit");
  };
}
