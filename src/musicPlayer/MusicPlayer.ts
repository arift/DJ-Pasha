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
  ButtonStyle,
  Client,
  EmbedBuilder,
  InteractionCollector,
  InteractionUpdateOptions,
  MessageCreateOptions,
  TextBasedChannel,
  VoiceBasedChannel,
  VoiceState,
} from "discord.js";
import metaEngine from "./MetaEngine";
import { removeMusicPlayer } from "./musicPlayerInstance";
import Queue, { QueueItem } from "./Queue";
import { SavedInfo } from "./types";
import { formatUsername, getArg, toHoursAndMinutes } from "./utils";

const getPageFooter = (
  page: number,
  lastPage: number,
  queueInfos: Array<{
    info: SavedInfo;
    request: QueueItem;
  }>
) => {
  let totalQueueSeconds: number = queueInfos.reduce(
    (cum, qInfo) => cum + Number(qInfo.info.lengthSeconds),
    0
  );
  return `Page ${page}/${lastPage}\nTotal number of songs in queue: ${queueInfos.length
    }\nTotal queue time: ${toHoursAndMinutes(totalQueueSeconds)}`;
};


const { getInfo, getInfos, getSong, insertNewPlay } = metaEngine;

class MusicPlayer {
  voiceChannel: VoiceBasedChannel;
  textChannel: TextBasedChannel;
  audioPlayer: AudioPlayer;
  client: Client;
  voiceConnection: VoiceConnection;
  queueCollector: InteractionCollector<any> | null = null;
  queue: Queue;
  playing = false;
  repeatingSong = false;
  nowPlaying: QueueItem | null = null;
  disconnectTimeout: NodeJS.Timeout | null;
  onVoiceStateUpdate: (oldState: VoiceState, newState: VoiceState) => void;
  constructor(
    voiceChannel: VoiceBasedChannel,
    textChannel: TextBasedChannel | null,
    client: Client
  ) {
    console.log(
      "Starting a new client for ",
      voiceChannel.name,
      " in ",
      voiceChannel.guild.name
    );
    this.voiceChannel = voiceChannel;
    if (!textChannel) throw new Error("Text channel is null");
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
      if (this.voiceChannel.members.size < 2) {
        console.log("No one is in server, starting disconnect timer.");
        this.audioPlayer.pause();
        this.startDiconnectTimeout();
      } else if (this.playing && this.disconnectTimeout) {
        this.stopDisconnectTimeout();
        if (this.audioPlayer.state.status === AudioPlayerStatus.Paused) {
          this.audioPlayer.unpause();
        }
      }
    };
    this.client.on("voiceStateUpdate", this.onVoiceStateUpdate);
    this.voiceConnection.on("stateChange", (oldConnection, newConnection) => {
      if (newConnection.status === "disconnected") {
        console.log(
          "Got kicked or disconnect for some reason. Stopping everything."
        );
        this.disconnect();
      }
    });
  }

  startDiconnectTimeout = (minutes: number = 1) => {
    if (this.disconnectTimeout) {
      return;
    }
    console.log(
      `Starting disconnect timeout. Will disconnect in ${minutes} minutes`
    );
    this.disconnectTimeout = setTimeout(this.disconnect, minutes * 60 * 1000);
  };

  stopDisconnectTimeout = () => {
    if (!this.disconnectTimeout) {
      return;
    }
    console.log("Stopping disconnect timeout.");
    clearTimeout(this.disconnectTimeout);
    this.disconnectTimeout = null;
  };

  disconnect = () => {
    console.log("Disconnecting. Clearing everything up...");
    clearTimeout(this.disconnectTimeout ?? undefined);
    this.disconnectTimeout = null;
    this.voiceConnection.destroy();
    this.audioPlayer.stop();
    if (this.queueCollector) {
      this.queueCollector.stop();
      this.queueCollector = null;
    }
    this.client.destroy();
    removeMusicPlayer();
  };

  async playNextSong() {
    this.playing = true; //this needs to come before pop in order to make sure the onChange properly caches the next song since it needs playing=true
    let nextItem: QueueItem | null = null;
    if (this.repeatingSong) {
      nextItem = this.nowPlaying;
    } else {
      nextItem = this.queue.pop();
    }
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
      console.log(`Playing next song: ${this.nowPlaying.id}`);
      const filePath = await getSong(this.nowPlaying.id);
      if (!filePath) {
        throw new Error(`Could not get song ${this.nowPlaying.id}`);
      }
      this.audioPlayer.play(createAudioResource(filePath));
      this.textChannel.send(await this.getNowPlayingStatus());
      try {
        await insertNewPlay(this.nowPlaying.id, this.nowPlaying.by);
      } catch (err) {
        console.error("Error with stat recording. Ignoring it: ", err);
      }
    } catch (err) {
      await new Promise((res) => {
        const error = `Unable to play <${nextItem.url}>. It may be age restricted. Skipping to the next song in the queue...`;
        console.error(error);
        this.textChannel.send(error);
        setTimeout(res, 5000);
      });
      await this.playNextSong();
    }
  }

  addSong(request: QueueItem | Array<QueueItem>) {
    if (Array.isArray(request)) {
      console.log(`Adding to queue playlist with ${request.length} songs`);
    } else {
      console.log(`Adding to queue ${request.url} by ${request.by}`);
    }
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

  clear(start?: number, end?: number) {
    this.queue.clear(start, end);
  }

  shuffle() {
    console.log("Shuffling queue...");
    this.queue.shuffle();
  }

  pause() {
    if (this.audioPlayer.state.status === AudioPlayerStatus.Paused) {
      this.audioPlayer.unpause();
    } else {
      this.audioPlayer.pause();
      this.startDiconnectTimeout(10);
    }
  }

  async skip() {
    console.log("Skipping song...");
    this.audioPlayer.stop();
  }

  setRepeat(repeat: boolean) {
    this.repeatingSong = repeat;
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
    const interactionUpdate: InteractionUpdateOptions = {
      content: "",
      embeds: [],
      components: [],
    };

    console.log("Showing queue starting from row ", startRow);

    const queueInfos = (
      await getInfos(this.queue.getAll().map((item) => item.id))
    ).map((info, idx) => ({
      info,
      request: this.queue.get(idx),
    }));

    let totalQueueSeconds: number = queueInfos.reduce(
      (cum, qInfo) => cum + Number(qInfo.info.lengthSeconds),
      0
    );

    const allQueueLines = queueInfos.map(
      (qInfo, idx) =>
        `**${idx + 1}**: ${qInfo.info.title} - *${formatUsername(
          qInfo.request.by,
          qInfo.request.byNickname
        )}*`
    );

    const embed = new EmbedBuilder().setColor("#33D7FF").setTitle("Next up:");

    if (allQueueLines.length === 0) {
      embed.setDescription("Queue is empty");
    } else if (allQueueLines.length > pageSize) {
      const queuePageLines = allQueueLines.slice(0, pageSize);
      const lastPage = Math.ceil(allQueueLines.length / pageSize);
      embed.setFooter({ text: getPageFooter(1, lastPage, queueInfos) });
      embed.setDescription(queuePageLines.join("\n"));
      if (this.queueCollector) {
        this.queueCollector.stop();
        this.queueCollector = null;
      }
      this.queueCollector = this.textChannel.createMessageComponentCollector({
        filter: (i) => i.customId.includes("--startIdx"),
      });
      const nextButton = new ButtonBuilder()
        .setStyle(ButtonStyle.Primary)
        .setCustomId(`--startIdx=${pageSize}`)
        .setLabel(`Next`);

      const prevButton = new ButtonBuilder()
        .setStyle(ButtonStyle.Primary)
        .setCustomId(`--startIdx=${0}`)
        .setDisabled(true)
        .setLabel("Previous");

      const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        prevButton,
        nextButton
      );

      interactionUpdate.components?.push(actionRow);
      this.queueCollector.on("collect", async (buttonInteraction) => {
        await buttonInteraction.deferUpdate();

        const queueInfos = (
          await getInfos(this.queue.getAll().map((item) => item.id))
        ).map((info, idx) => ({
          info,
          request: this.queue.get(idx),
        }));

        const startIdx = Number(
          getArg("--startIdx", [buttonInteraction.customId])
        );
        const lastQueueIdx = queueInfos.length - 1;
        const endIdx =
          startIdx + pageSize > lastQueueIdx
            ? lastQueueIdx
            : startIdx + pageSize;

        const prevPageIdx = startIdx - pageSize < 0 ? 0 : startIdx - pageSize;
        prevButton
          .setCustomId(`--startIdx=${prevPageIdx}`)
          .setDisabled(startIdx === 0);
        nextButton
          .setCustomId(`--startIdx=${endIdx}`)
          .setDisabled(lastQueueIdx === endIdx && startIdx !== 0);

        const queueLines = queueInfos
          .slice(startIdx, endIdx === startIdx ? endIdx + 1 : endIdx)
          .map(
            (qInfo, idx) =>
              `**${idx + 1 + startIdx}**: ${qInfo.info.title
              } - *${formatUsername(
                qInfo.request.by,
                qInfo.request.byNickname
              )}*`
          );

        const page = startIdx / pageSize + 1;
        const lastPage = Math.ceil(queueInfos.length / pageSize);
        if (queueLines.length === 0) {
          this.getQueueStatus(prevPageIdx, pageSize);
          return;
        }
        embed
          .setFooter({
            text: getPageFooter(page, lastPage, queueInfos),
          })
          .setDescription(
            queueLines.length === 0 ? "Empty." : queueLines.join("\n")
          );

        await buttonInteraction.editReply({
          ...interactionUpdate,
          embeds: [embed],
          components: [actionRow],
        });
      });

      this.queueCollector.on("end", async (collected) => {
        console.log(`Collector end ${collected.size} items`);
        this.queueCollector = null;
      });
    } else {
      embed
        .setFooter({
          text: `Total queue time: ${toHoursAndMinutes(totalQueueSeconds)}`,
        })
        .setDescription(allQueueLines.join("\n"));
    }
    interactionUpdate.embeds?.push(embed);
    return interactionUpdate;
  }
}

export default MusicPlayer;
