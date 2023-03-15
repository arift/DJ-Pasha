import {
  AudioPlayer,
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  joinVoiceChannel,
  VoiceConnection,
} from "@discordjs/voice";
import {
  EmbedBuilder,
  GuildTextBasedChannel,
  MessageCreateOptions,
  VoiceBasedChannel,
} from "discord.js";
import fs from "fs";
import sqlite3 from "sqlite3";
import ytdl from "ytdl-core";
import { CACHE_PATH, STAGING_PATH } from "./cache";
import { shuffle, toHoursAndMinutes } from "./utils";

export type SavedInfo = {
  title: string;
  ownerChannelName: string;
  description: string;
  lengthSeconds: string;
  videoUrl: string;
};

type SongRequest = { url: string; by: string };

class MusicPlayer {
  voiceChannel: VoiceBasedChannel;
  textChannel: GuildTextBasedChannel;
  audioPlayer: AudioPlayer;
  voiceConnection: VoiceConnection;
  queueu: Array<SongRequest>;
  playing = false;
  nowPlaying: SongRequest | null = null;
  db: sqlite3.Database;
  hydraterInterval: NodeJS.Timer;

  constructor(
    voiceChannel: VoiceBasedChannel,
    textChannel: GuildTextBasedChannel,
    db: sqlite3.Database
  ) {
    this.voiceChannel = voiceChannel;
    this.textChannel = textChannel;
    this.db = db;
    this.voiceConnection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });
    this.queueu = [];
    this.audioPlayer = createAudioPlayer();
    this.voiceConnection.subscribe(this.audioPlayer);
    const musicPlayer = this;
    this.hydraterInterval = this.startHydraterInterval();

    this.audioPlayer.on(AudioPlayerStatus.Idle, async () => {
      console.log("In idle, playing next song");
      if (musicPlayer.queueu.length === 0) {
        console.log("No new song. Stopping play");
        musicPlayer.playing = false;
        musicPlayer.nowPlaying = null;
        musicPlayer.textChannel.send("No more songs in the queue. Pausing.");
        clearInterval(musicPlayer.hydraterInterval);
        musicPlayer.hydraterInterval = null;
      } else {
        await musicPlayer.playNextSong();
      }
    });
  }

  startHydraterInterval() {
    return setInterval(() => {
      if (this.queueu.length > 0) {
        this.ensureSongCached(this.queueu[0].url);
      }
    }, 5000);
  }

  getVideoInfo = (url: string) =>
    new Promise<SavedInfo>(async (res, rej) => {
      let videoId: string;
      try {
        videoId = ytdl.getURLVideoID(url);
      } catch (err) {
        throw new Error("Bad URL input. Check your YouTube URL: " + url);
      }
      console.log(`getVideoInfo[${videoId}]: Getting video info`);
      this.db.get(
        "select * from video_info where video_id = $videoId",
        {
          $videoId: videoId,
        },
        async (err, row) => {
          if (err) {
            rej(err);
            return;
          }

          if (!row) {
            console.log(`getVideoInfo[${videoId}]: Not in cache, fetching it.`);
            const info = await ytdl.getInfo(url);
            const savedInfo: SavedInfo = {
              title: info.videoDetails.title,
              ownerChannelName: info.videoDetails.ownerChannelName,
              description: info.videoDetails.description,
              lengthSeconds: info.videoDetails.lengthSeconds,
              videoUrl: info.videoDetails.video_url,
            };
            console.log(
              `getVideoInfo[${videoId}]: Done fetching. Adding to cache.`
            );
            this.db.run(
              "INSERT OR REPLACE INTO video_info (video_id, info) VALUES(:videoId, :info)",
              [videoId, JSON.stringify(savedInfo)]
            );
            return res(await this.getVideoInfo(url));
          }
          console.log(`getVideoInfo[${videoId}]: Info in cache. Returning it.`);
          res(JSON.parse(row.info));
        }
      );
    });

  addSong(request: SongRequest) {
    console.log(`addSong(${request.url})`);
    this.queueu.push(request);
  }

  ensureSongCached = (url: string) =>
    new Promise<string>((res, rej) => {
      console.log(`addSongToCache[${url}]: Adding song to cache, if needed.`);
      const videoId = ytdl.getURLVideoID(url);
      const cachedFilePath = `${CACHE_PATH}/${videoId}.webm`;
      if (fs.existsSync(cachedFilePath)) {
        console.log(`addSongToCache[${url}]: Already in cache.`);
        res(cachedFilePath);
      } else {
        const t = Date.now();
        console.log(`addSongToCache[${url}]: Not in cache, downloading it...`);
        const ytStream = ytdl(url, { filter: "audioonly", quality: "251" });
        const stagingPath = `${STAGING_PATH}/${videoId}.webm`;
        ytStream.pipe(fs.createWriteStream(stagingPath));
        ytStream.on("end", (args) => {
          console.log(
            `addSongToCache[${url}]: Downloaded it in ${
              (Date.now() - t) / 1000
            } seconds`
          );
          try {
            fs.renameSync(stagingPath, cachedFilePath);
            res(cachedFilePath);
          } catch (err) {
            console.error(err);
          }
        });
      }
    });

  move(from: number, to: number = 1) {
    const fromIdx = from - 1;
    const toIdx = to - 1;
    if (
      to < 1 ||
      from < 1 ||
      from > this.queueu.length ||
      to > this.queueu.length
    ) {
      throw new Error(
        `Out of bounds move request. From: ${from}, to: ${to}, queue size: ${this.queueu.length}`
      );
    }
    this.queueu.splice(toIdx, 0, this.queueu.splice(fromIdx, 1)[0]);
  }

  remove(position: number) {
    if (position > this.queueu.length) {
      throw new Error(
        `Out of bounds remove request. Position: ${position}, queue size: ${this.queueu.length}`
      );
    }
    const positionIdx = position - 1;
    this.queueu.splice(positionIdx, 1);
  }

  shuffle() {
    this.queueu = shuffle(this.queueu);
  }

  async skip() {
    this.audioPlayer.stop();
    await this.playNextSong();
  }

  async playNextSong() {
    const queuedItem = this.queueu.shift();
    if (!queuedItem) return;

    console.log(`playNextSong[${queuedItem.url}]`);
    const filePath = await this.ensureSongCached(queuedItem.url);
    this.nowPlaying = queuedItem;
    this.audioPlayer.play(createAudioResource(filePath));
    this.textChannel.send(await this.getNowPlayingStatus());
    if (!this.playing) {
      this.playing = true;
    }
    if (!this.hydraterInterval) {
      this.hydraterInterval = this.startHydraterInterval();
    }
  }

  async getNowPlayingStatus() {
    if (!this.nowPlaying) {
      return "";
    }
    const songRequest = this.nowPlaying;
    const nowPlayingInfo = await this.getVideoInfo(songRequest.url);
    const nowPlayingText = `
    **${nowPlayingInfo.title} - ${nowPlayingInfo.ownerChannelName}**
    
    **Duration**: \`${toHoursAndMinutes(Number(nowPlayingInfo.lengthSeconds))}\`
    **Requester**: \`${songRequest.by}\`
    **Queue   **: \`${this.queueu.length}\`
    `;
    const toSend: MessageCreateOptions = {
      content: "",
      embeds: [
        new EmbedBuilder()
          .setColor("#33D7FF")
          .setTitle("Now Playing")
          .setDescription(nowPlayingText),
      ],
    };
    return toSend;
  }

  async getQueueStatus() {
    const playListInfo: Array<SavedInfo & { by: SongRequest["by"] }> = [];
    for (let idx = 0; idx < this.queueu.length; idx++) {
      const songRequest = this.queueu[idx];
      const info = await this.getVideoInfo(songRequest.url);
      playListInfo.push({ ...info, by: songRequest.by });
    }

    let queueText: string;
    if (playListInfo.length) {
      queueText = `${playListInfo
        .map((info, idx) => `**${idx + 1}**: ${info.title} (*${info.by}*)`)
        .join("\n")}`;
    }

    const toSend: MessageCreateOptions = {
      content: "",
      embeds: [
        new EmbedBuilder()
          .setColor("#33D7FF")
          .setTitle("Next up:")
          .setDescription(queueText ?? "Queue is empty"),
      ],
    };
    return toSend;
  }
}

export default MusicPlayer;
