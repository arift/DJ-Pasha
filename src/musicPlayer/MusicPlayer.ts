import {
  AudioPlayer,
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  joinVoiceChannel,
  VoiceConnection,
} from "@discordjs/voice";
import {
  Client,
  EmbedBuilder,
  GuildTextBasedChannel,
  MessageCreateOptions,
  VoiceBasedChannel,
  VoiceState,
} from "discord.js";
import fs from "fs";
import sqlite3 from "sqlite3";
import ytdl from "ytdl-core";
import { CACHE_PATH, STAGING_PATH } from "./cache";
import { removeMusicPlayer } from "./musicPlayersByChannel";
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
  client: Client;
  voiceConnection: VoiceConnection;
  queueu: Array<SongRequest>;
  playing = false;
  nowPlaying: SongRequest | null = null;
  db: sqlite3.Database;
  hydraterInterval: NodeJS.Timer | null;
  disconnectTimeout: NodeJS.Timeout | null;
  onVoiceStateUpdate: (oldState: VoiceState, newState: VoiceState) => void;
  constructor(
    voiceChannel: VoiceBasedChannel,
    textChannel: GuildTextBasedChannel,
    db: sqlite3.Database,
    client: Client
  ) {
    console.log(
      "Starting a new client for ",
      voiceChannel.name,
      " in ",
      voiceChannel.guild.name
    );
    this.voiceChannel = voiceChannel;
    this.textChannel = textChannel;
    this.db = db;
    this.client = client;
    this.voiceConnection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });
    this.queueu = [];
    this.audioPlayer = createAudioPlayer();
    this.voiceConnection.subscribe(this.audioPlayer);
    const musicPlayer = this;
    this.audioPlayer.on(AudioPlayerStatus.Idle, async () => {
      console.log("In idle, playing next song");
      await musicPlayer.playNextSong();
    });
    this.onVoiceStateUpdate = () => {
      if (this.voiceChannel.members.size < 2) {
        console.log("No one is in server, starting disconnect timer.");
        this.startDiconnectTimeout();
        this.stopHydrateInterval();
      } else if (this.playing) {
        this.stopDisconnectTimeout();
        this.startHydrateInterval();
      }
    };
    this.client.on("voiceStateUpdate", this.onVoiceStateUpdate);
  }

  startDiconnectTimeout = () => {
    if (this.disconnectTimeout) {
      return;
    }
    console.log("Starting disconnect timeout.");
    this.disconnectTimeout = setTimeout(() => {
      console.log("Disconnecting. Clearing everything up...");
      this.voiceConnection.disconnect();
      this.voiceConnection.destroy();
      this.audioPlayer.removeAllListeners();
      this.client.removeListener("voiceStateUpdate", this.onVoiceStateUpdate);
      this.stopHydrateInterval();
      removeMusicPlayer(this.voiceChannel);
    }, 60000);
  };

  stopDisconnectTimeout = () => {
    if (!this.disconnectTimeout) {
      return;
    }
    console.log("Stopping disconnect timeout.");
    clearTimeout(this.disconnectTimeout);
    this.disconnectTimeout = null;
  };

  startHydrateInterval = () => {
    if (this.hydraterInterval) {
      return;
    }
    console.log("Startting hyrdate interval.");
    this.hydraterInterval = setInterval(() => {
      if (this.queueu.length > 0) {
        this.ensureSongCached(this.queueu[0].url);
      }
    }, 5000);
  };

  stopHydrateInterval = () => {
    if (!this.hydraterInterval) {
      return;
    }
    console.log("Stopping hydrate interval.");
    clearInterval(this.hydraterInterval);
    this.hydraterInterval = null;
  };

  async playNextSong() {
    const queuedItem = this.queueu.shift();
    try {
      //clean up and start the disconnect timer, since we're out of songs
      if (!queuedItem) {
        this.startDiconnectTimeout();
        this.stopHydrateInterval();
        this.playing = false;
        this.nowPlaying = null;
        this.textChannel.send(
          "No more songs in the queue. DJ Pasha will disconnect in 60 seconds."
        );
        return;
      }
      //ensure we're in playing state
      this.stopDisconnectTimeout();
      this.playing = true;
      this.nowPlaying = queuedItem;
      this.startHydrateInterval();

      //play next song
      console.log(`Playing next song: ${queuedItem.url}`);
      const videoId = ytdl.getURLVideoID(queuedItem.url);
      const filePath = await this.ensureSongCached(queuedItem.url);
      this.audioPlayer.play(createAudioResource(filePath));
      this.textChannel.send(await this.getNowPlayingStatus());
      await new Promise<void>((res) =>
        this.db.run(
          `
        INSERT OR IGNORE INTO plays_info (video_id, username, play_count)
        VALUES ($videoId, $username, 0)
      `,
          {
            $videoId: videoId,
            $username: queuedItem.by,
          },
          () => {
            res();
          }
        )
      );
      this.db.run(
        `
        UPDATE OR IGNORE plays_info 
        SET play_count = play_count + 1, last_play = CURRENT_TIMESTAMP
        WHERE video_id = $videoId AND username = $username
       `,
        {
          $videoId: videoId,
          $username: queuedItem.by,
        }
      );
    } catch (err) {
      await new Promise((res) => {
        console.log(
          "Problem while playing song. Waiting five seconds before attempting agian..."
        );
        setTimeout(res, 5000);
      });
      await this.playNextSong();
    }
  }

  getVideoInfo = (url: string) =>
    new Promise<SavedInfo>(async (res, rej) => {
      let videoId: string;
      try {
        videoId = ytdl.getURLVideoID(url);
      } catch (err) {
        rej("Bad URL input. Check your YouTube URL: " + url);
        return;
      }

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

          if (row) {
            res(JSON.parse(row.info));
            return;
          }

          console.log(`Fetching video info: ${url}`);
          const info = await ytdl.getInfo(url);
          const savedInfo: SavedInfo = {
            title: info.videoDetails.title,
            ownerChannelName: info.videoDetails.ownerChannelName,
            description: info.videoDetails.description,
            lengthSeconds: info.videoDetails.lengthSeconds,
            videoUrl: info.videoDetails.video_url,
          };

          res(savedInfo);
          this.db.run(
            "INSERT OR REPLACE INTO video_info (video_id, info) VALUES($videoId, $info)",
            { $videoId: videoId, $info: JSON.stringify(savedInfo) }
          );
          return;
        }
      );
    });

  addSong(request: SongRequest) {
    console.log(`Adding song to the queue ${request.url}`);
    this.queueu.push(request);
  }

  ensureSongCached = (url: string) =>
    new Promise<string>((res, rej) => {
      const videoId = ytdl.getURLVideoID(url);
      const cachedFilePath = `${CACHE_PATH}/${videoId}`;
      if (fs.existsSync(cachedFilePath)) {
        res(cachedFilePath);
      } else {
        try {
          const t = Date.now();
          console.log(`Song not in cache, downloading it: ${url}`);
          const ytStream = ytdl(url, {
            filter: "audioonly",
            quality: "highestaudio",
          });
          const stagingPath = `${STAGING_PATH}/${videoId}`;
          ytStream.pipe(fs.createWriteStream(stagingPath));
          ytStream.on("error", (err) => {
            rej(err);
          });
          ytStream.on("end", (args) => {
            console.log(
              `Song downloaded it in ${(Date.now() - t) / 1000} seconds: ${url}`
            );
            try {
              if (
                !fs.existsSync(cachedFilePath) &&
                fs.existsSync(stagingPath)
              ) {
                fs.renameSync(stagingPath, cachedFilePath);
              }
              res(cachedFilePath);
            } catch (err) {
              console.error("Rename error: ", err);
              rej();
            }
          });
        } catch (err) {
          console.error("Error caching song: ", err);
          rej();
        }
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
    console.log("Skipping song...");
    this.audioPlayer.stop();
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
    let totalQueueSeconds: number = 0;
    const embed = new EmbedBuilder().setColor("#33D7FF").setTitle("Next up:");
    if (playListInfo.length) {
      const queueLines = [];
      playListInfo.forEach((info, idx) => {
        queueLines.push(`**${idx + 1}**: ${info.title} (*${info.by}*)`);
        totalQueueSeconds += Number(info.lengthSeconds);
      });
      embed.setDescription(queueLines.join("\n"));
      embed.setFooter({
        text: `Total queue time: ${toHoursAndMinutes(totalQueueSeconds)}`,
      });
    } else {
      embed.setDescription("Queue is empty");
    }

    const toSend: MessageCreateOptions = {
      content: "",
      embeds: [embed],
    };
    return toSend;
  }
}

export default MusicPlayer;
