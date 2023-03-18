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
import ytdl from "ytdl-core";
import { getDb } from "./db";
import { removeMusicPlayer } from "./musicPlayersByChannel";
import { DB_PATH } from "./paths";
import { getInfo, getInfos, getSong } from "./processor";
import Queue, { QueueItem } from "./Queue";
import { SavedInfo } from "./types";
import { toHoursAndMinutes } from "./utils";

const db = getDb(DB_PATH);

db.run(`
  CREATE TABLE IF NOT EXISTS video_info (
    video_id TEXT PRIMARY KEY, 
    info TEXT, 
    insertion_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`);

db.run(`
  CREATE TABLE IF NOT EXISTS plays (
    video_id TEXT, 
    username TEXT, 
    play_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
    PRIMARY KEY (video_id, username, play_timestamp)
  )`);

class MusicPlayer {
  voiceChannel: VoiceBasedChannel;
  textChannel: GuildTextBasedChannel;
  audioPlayer: AudioPlayer;
  client: Client;
  voiceConnection: VoiceConnection;
  queue: Queue;
  playing = false;
  nowPlaying: QueueItem | null = null;
  disconnectTimeout: NodeJS.Timeout | null;
  onVoiceStateUpdate: (oldState: VoiceState, newState: VoiceState) => void;
  constructor(
    voiceChannel: VoiceBasedChannel,
    textChannel: GuildTextBasedChannel,
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
    this.client = client;
    this.voiceConnection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });
    this.queue = new Queue({
      onChange: (queue) => {
        if (queue.length > 0 && this.playing) {
          this.ensureSongCached(queue[0].url);
        }
      },
    });
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
      } else if (this.playing) {
        this.stopDisconnectTimeout();
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

  async playNextSong() {
    const nextItem = this.queue.pop();
    try {
      //clean up and start the disconnect timer, since we're out of songs
      if (!nextItem) {
        this.startDiconnectTimeout();
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
      this.nowPlaying = nextItem;

      //play next song
      console.log(`Playing next song: ${nextItem.url}`);
      const videoId = ytdl.getURLVideoID(nextItem.url);
      const filePath = await this.ensureSongCached(nextItem.url);
      this.audioPlayer.play(createAudioResource(filePath));
      this.textChannel.send(await this.getNowPlayingStatus());
      try {
        await db.runSync(
          `
            INSERT OR IGNORE INTO plays (video_id, username)
            VALUES ($videoId, $username)
          `,
          {
            $videoId: videoId,
            $username: nextItem.by,
          }
        );
        console.log(
          `Added new stat for video ${videoId} and user ${nextItem.by}`
        );
      } catch (err) {
        console.error("Error with stat recording. Ignoring it: ", err);
      }
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

  getVideoInfo = async (url: string) => {
    let videoId: string;
    try {
      videoId = ytdl.getURLVideoID(url);
    } catch (err) {
      throw new Error("Bad URL input. Check your YouTube URL: " + url);
    }
    return await getInfo(videoId);
  };

  addSong(request: QueueItem | Array<QueueItem>) {
    console.log(`Adding to queue: `, request);
    this.queue.enqueue(request);
  }

  ensureSongCached = async (url: string) => {
    const videoId = ytdl.getURLVideoID(url);
    return await getSong(videoId);
  };

  move(from: number, to: number = 1) {
    const fromIdx = from - 1;
    const toIdx = to - 1;
    try {
      this.queue.move(fromIdx, toIdx);
    } catch (err) {
      throw new Error(
        `Error move request. From: ${from}, to: ${to}, queue size: ${this.queue.size()}`
      );
    }
  }

  remove(position: number) {
    if (position > this.queue.size()) {
      throw new Error(
        `Out of bounds remove request. Position: ${position}, queue size: ${this.queue.size()}`
      );
    }
    this.queue.remove(position - 1);
  }

  shuffle() {
    console.log("Shuffling queue...");
    this.queue.shuffle();
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
    **Queue   **: \`${this.queue.size()}\`
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
    const queueItemPage: Array<QueueItem> = [];
    for (let idx = 0; idx < this.queue.size() && idx < 10; idx++) {
      queueItemPage.push(this.queue.get(idx));
    }
    const savedInfos = await getInfos(
      queueItemPage.map((item) => ytdl.getVideoID(item.url))
    );

    const playListInfo: Array<SavedInfo & { by: QueueItem["by"] }> =
      savedInfos.map((info, idx) => ({
        ...info,
        by: queueItemPage[idx].by,
      }));

    let totalQueueSeconds: number = 0;
    const embed = new EmbedBuilder().setColor("#33D7FF").setTitle("Next up:");

    if (playListInfo.length) {
      const queueLines = [];
      playListInfo.forEach((info, idx) => {
        queueLines.push(`**${idx + 1}**: ${info.title} (*${info.by}*)`);
        totalQueueSeconds += Number(info.lengthSeconds);
      });
      const hiddenSongs = this.queue.size() - playListInfo.length;
      if (hiddenSongs > 0) {
        queueLines.push(`...and ${hiddenSongs} more.`);
      }
      embed.setDescription(queueLines.join("\n"));
      embed.setFooter({
        text: `Total queue time: \`${toHoursAndMinutes(totalQueueSeconds)}\``,
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
