import {
  AudioPlayer,
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  joinVoiceChannel,
  VoiceConnection,
} from "@discordjs/voice";
import {
  CacheType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  GuildTextBasedChannel,
  MessageCreateOptions,
  SlashCommandBuilder,
  VoiceBasedChannel,
} from "discord.js";
import fs from "fs";
import sqlite3 from "sqlite3";
import ytdl from "ytdl-core";

const CACHE_PATH = "cache";
const STAGING_PATH = `${CACHE_PATH}/staging`;
const DB_PATH = `${CACHE_PATH}/cache.db`;

if (!fs.existsSync(CACHE_PATH)) {
  fs.mkdirSync(CACHE_PATH);
}

if (!fs.existsSync(STAGING_PATH)) {
  fs.mkdirSync(STAGING_PATH);
}

const db = new sqlite3.Database(DB_PATH);
db.run(
  "CREATE TABLE IF NOT EXISTS video_info (video_id TEXT PRIMARY KEY, info TEXT, insertion_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL)"
);

const toHoursAndMinutes = (totalSeconds: number) => {
  const totalMinutes = Math.floor(totalSeconds / 60);

  const seconds = String(totalSeconds % 60).padStart(2, "0");
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  const hours = Math.floor(totalMinutes / 60);

  return [hours, minutes, seconds].join(":");
};

const getVideoInfo = (url: string) =>
  new Promise<SavedInfo>(async (res, rej) => {
    let videoId: string;
    try {
      videoId = ytdl.getURLVideoID(url);
    } catch (err) {
      throw new Error("Bad URL input. Check your YouTube URL: " + url);
    }
    console.log(`getVideoInfo[${videoId}]: Getting video info`);
    db.get(
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
          db.run(
            "INSERT OR REPLACE INTO video_info (video_id, info) VALUES(:videoId, :info)",
            [videoId, JSON.stringify(savedInfo)]
          );
          return res(await getVideoInfo(url));
        }
        console.log(`getVideoInfo[${videoId}]: Info in cache. Returning it.`);
        res(JSON.parse(row.info));
      }
    );
  });

type SavedInfo = {
  title: string;
  ownerChannelName: string;
  description: string;
  lengthSeconds: string;
  videoUrl: string;
};
const musicPlayersByChannel: { [id: string]: MusicPlayer } = {};

type SongRequest = { url: string; by: string };
class MusicPlayer {
  voiceChannel: VoiceBasedChannel;
  textChannel: GuildTextBasedChannel;
  audioPlayer: AudioPlayer;
  voiceConnection: VoiceConnection;
  queueu: Array<SongRequest> = [];
  playing = false;
  nowPlaying: SongRequest | null = null;

  constructor(
    voiceChannel: VoiceBasedChannel,
    textChannel: GuildTextBasedChannel
  ) {
    this.voiceChannel = voiceChannel;
    this.textChannel = textChannel;
    this.voiceConnection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });
    this.audioPlayer = createAudioPlayer();
    this.voiceConnection.subscribe(this.audioPlayer);
  }

  addSong(request: SongRequest) {
    console.log("Added song to the queue ", request.url);
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
            console.log(`addSongToCache[${url}]: Rename failed!`);
          }
        });
      }
    });

  move(from: number, to: number = 1) {
    const fromIdx = from - 1;
    const toIdx = to - 1;
    if (to < 1 || from > this.queueu.length) {
      throw new Error(
        `Out of bounds move request. From: ${from}, to: ${to}, queue size: ${this.queueu.length}`
      );
    }
    const temp = this.queueu[toIdx];
    this.queueu[toIdx] = this.queueu[fromIdx];
    this.queueu[fromIdx] = temp;
  }

  async play() {
    const musicPlayer = this;
    this.playing = true;
    const playNextSong = async () => {
      const queuedItem = this.queueu.shift();
      console.log(`play[${queuedItem}]: Playing next song...`);
      if (!queuedItem) return;
      const filePath = await this.ensureSongCached(queuedItem.url);
      //precache next
      if (this.queueu.length > 0) {
        await this.ensureSongCached(this.queueu[0].url);
      }
      console.log("Playing url next", queuedItem);
      this.nowPlaying = queuedItem;
      this.audioPlayer.play(createAudioResource(filePath));
      musicPlayer.sendNowPlayingStatus();
    };

    this.audioPlayer.on(AudioPlayerStatus.Idle, async () => {
      console.log("In idle, playing next song");
      if (musicPlayer.queueu.length === 0) {
        musicPlayer.playing = false;
        musicPlayer.nowPlaying = null;
        musicPlayer.textChannel.send("No more songs in the queue. Pausing.");
        console.log("No new song. Stopping play");
      } else {
        await playNextSong();
      }
    });
    await playNextSong();
  }

  async sendNowPlayingStatus() {
    if (!this.nowPlaying) {
      return;
    }
    const songRequest = this.nowPlaying;
    const nowPlayingInfo = await getVideoInfo(songRequest.url);
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
    this.textChannel.send(toSend);
  }

  async sendQueueStatus() {
    const playListInfo: Array<SavedInfo & { by: SongRequest["by"] }> = [];
    for (let idx = 0; idx < this.queueu.length; idx++) {
      const songRequest = this.queueu[idx];
      const info = await getVideoInfo(songRequest.url);
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
    this.textChannel.send(toSend);
  }
}

export const playCommand = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song or add one to the queue.")
    .addStringOption((option) =>
      option.setName("url").setDescription("URL of song").setRequired(true)
    ),
  execute: async (interaction: ChatInputCommandInteraction<CacheType>) => {
    const username = interaction.user.username;
    const voiceChannel = (interaction.member as GuildMember).voice.channel;
    const textChannel = interaction.channel;
    const url = interaction.options.getString("url").trim();
    await interaction.deferReply();
    const info = await getVideoInfo(url);

    try {
      if (!musicPlayersByChannel[voiceChannel.id]) {
        musicPlayersByChannel[voiceChannel.id] = new MusicPlayer(
          voiceChannel,
          textChannel
        );
      }

      const musicPlayer = musicPlayersByChannel[voiceChannel.id];
      musicPlayer.addSong({ url, by: username });

      if (!musicPlayer.playing) {
        try {
          await musicPlayer.play();
        } catch (error) {
          console.error("music player error", error);
        }
      }

      //song you just added is the only one in queue, cache it
      if (musicPlayer.queueu.length === 1) {
        musicPlayer.ensureSongCached(musicPlayer.queueu[0].url);
      }

      await interaction.editReply(
        `:notes: Added **${info.title}** to the queue.`
      );
      // musicPlayer.sendStatus();
    } catch (err) {
      await interaction.editReply(`Error: ${err}`);
    }
  },
};

export const queueCommand = {
  data: new SlashCommandBuilder().setName("queue").setDescription("Show queue"),
  execute: async (interaction: ChatInputCommandInteraction<CacheType>) => {
    const voiceChannel = (interaction.member as GuildMember).voice.channel;
    if (!musicPlayersByChannel[voiceChannel.id]) {
      interaction.reply(
        "You don't have any songs playing. Add songs to the queue with /play command."
      );
      return;
    }

    interaction.deferReply();
    interaction.deleteReply();

    const musicPlayer = musicPlayersByChannel[voiceChannel.id];
    musicPlayer.sendQueueStatus();
  },
};

export const moveCommand = {
  data: new SlashCommandBuilder()
    .setName("mv")
    .setDescription(
      "Move a song in the queue. If `to` is not provided, it will move to the top of the queue."
    )
    .addNumberOption((option) => {
      return option
        .setName("from")
        .setDescription("from queue spot")
        .setRequired(true);
    })
    .addNumberOption((option) => {
      return option
        .setName("to")
        .setDescription(
          "to queue spot (leave empty to move to the top of the queue)"
        )
        .setRequired(false);
    }),
  execute: async (interaction: ChatInputCommandInteraction<CacheType>) => {
    const voiceChannel = (interaction.member as GuildMember).voice.channel;
    const from = interaction.options.getNumber("from");
    const to = interaction.options.getNumber("to", false) ?? 1;
    if (!musicPlayersByChannel[voiceChannel.id]) {
      interaction.reply(
        "You don't have any songs playing. Add songs to the queue with /play command."
      );
      return;
    }

    const musicPlayer = musicPlayersByChannel[voiceChannel.id];
    try {
      musicPlayer.move(from, to);
    } catch (err) {
      interaction.reply(err.message);
      return;
    }
    interaction.deferReply();
    interaction.deleteReply();
    musicPlayer.sendQueueStatus();
  },
};
