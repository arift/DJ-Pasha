import {
  AudioPlayer,
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  joinVoiceChannel,
  VoiceConnection,
} from "@discordjs/voice";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GuildTextBasedChannel,
  InteractionCollector,
  InteractionUpdateOptions,
  MessageCreateOptions,
  VoiceBasedChannel,
  VoiceState,
} from "discord.js";
import { getDb } from "./db";
import { removeMusicPlayer } from "./musicPlayersByChannel";
import { DB_PATH } from "./paths";
import { getInfo, getInfos, getSong } from "./processor";
import Queue, { QueueItem } from "./Queue";
import { getArg, toHoursAndMinutes } from "./utils";

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
  queueCollector: InteractionCollector<any> | null = null;
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
          getSong(queue[0].id);
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
    this.onVoiceStateUpdate = (oldState, newState) => {
      if (
        this.voiceChannel.members.size < 2 ||
        (oldState.channelId && !newState.channelId)
      ) {
        console.log(
          "No one is in server or got kicked out of the channel, starting disconnect timer."
        );
        this.startDiconnectTimeout();
      } else {
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
    this.playing = true; //this needs to come before pop in order to make sure the onChange properly caches the next song since it needs playing=true
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
      this.nowPlaying = nextItem;

      //play next song
      console.log(`Playing next song: ${nextItem.id}`);
      const filePath = await getSong(nextItem.id);
      this.audioPlayer.play(createAudioResource(filePath));
      this.textChannel.send(await this.getNowPlayingStatus());
      try {
        await db.runSync(
          `
            INSERT OR IGNORE INTO plays (video_id, username)
            VALUES ($videoId, $username)
          `,
          {
            $videoId: nextItem.id,
            $username: nextItem.by,
          }
        );
        console.log(
          `Added new stat for video ${nextItem.id} and user ${nextItem.by}`
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

  addSong(request: QueueItem | Array<QueueItem>) {
    console.log(`Adding to queue: `, request);
    this.queue.enqueue(request);
  }

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
    const nowPlayingInfo = await getInfo(songRequest.id);
    const nowPlayingText = `
    **${nowPlayingInfo.title}**
    
    **Duration**: \`${toHoursAndMinutes(Number(nowPlayingInfo.lengthSeconds))}\`
    **Requester**: \`${formatUsername(songRequest.by, songRequest.byNickname)}\`
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

  async getQueueStatus(startRow = 0, pageSize = 10) {
    const toSend: InteractionUpdateOptions = {
      content: "",
      embeds: [],
      components: [],
    };

    console.log("Showing queue starting from row ", startRow);
    const totalQueueSize = this.queue.size();
    const lastRowIdx =
      totalQueueSize < pageSize + startRow
        ? totalQueueSize
        : pageSize + startRow;

    const queueItemPage = this.queue.slice(startRow, lastRowIdx);

    const playlistInfos = await getInfos(queueItemPage.map((item) => item.id));

    let totalQueueSeconds: number = 0;
    const embed = new EmbedBuilder().setColor("#33D7FF").setTitle("Next up:");

    if (playlistInfos.length) {
      const queueLines = [];
      playlistInfos.forEach((info, idx) => {
        queueLines.push(
          `**${startRow + idx + 1}**: ${info.title} - *${formatUsername(
            queueItemPage[idx].by,
            queueItemPage[idx].byNickname
          )}*`
        );
        totalQueueSeconds += Number(info.lengthSeconds);
      });

      const hiddenSongs = this.queue.size() - lastRowIdx;

      //figure out if we need pagination
      if (startRow > 0 || hiddenSongs > 0) {
        //has page info
        if (this.queueCollector) {
          this.queueCollector.stop();
          this.queueCollector = null;
        }

        this.queueCollector = this.textChannel.createMessageComponentCollector({
          filter: (i) => i.customId.includes("--queuePage"),
        });

        this.queueCollector.on(
          "collect",
          async (buttonInteraction: ButtonInteraction) => {
            await buttonInteraction.deferUpdate();
            console.log("Collected page");
            const queuePage = getArg("--queuePage", [
              buttonInteraction.customId,
            ]);
            await buttonInteraction.editReply({
              ...toSend,
              embeds: [{ ...embed, description: "Loading next page..." }],
            });
            await buttonInteraction.editReply(
              await this.getQueueStatus(Number(queuePage))
            );
          }
        );

        this.queueCollector.on("end", (collected) => {
          console.log(`Collected ${collected.size} items`);
          this.queueCollector = null;
        });

        const nextButton = new ButtonBuilder()
          .setCustomId(`--queuePage=${lastRowIdx}`)
          .setDisabled(hiddenSongs === 0)
          .setStyle(ButtonStyle.Primary)
          .setLabel(`Next`);

        const prevButton = new ButtonBuilder()
          .setCustomId(`--queuePage=${startRow - pageSize}`)
          .setDisabled(startRow === 0)
          .setStyle(ButtonStyle.Primary)
          .setLabel("Previous");

        const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          prevButton,
          nextButton
        );
        toSend.components.push(actionRow);
        const page = startRow / pageSize + 1;
        const lastPage = Math.ceil(totalQueueSize / pageSize);
        embed.setFooter({
          text: `Page ${page}/${lastPage}\nPage queue time: ${toHoursAndMinutes(
            totalQueueSeconds
          )}`,
        });
      } else {
        //no pagination needed
        embed.setFooter({
          text: `Total queue time: ${toHoursAndMinutes(totalQueueSeconds)}`,
        });
      }

      embed.setDescription(queueLines.join("\n"));
    } else {
      embed.setDescription("Queue is empty");
    }
    toSend.embeds.push(embed);

    return toSend;
  }
}

const formatUsername = (username: string, nickname: string | null) => {
  if (nickname) {
    return `${nickname} (${username})`;
  }
  return username;
};
export default MusicPlayer;
