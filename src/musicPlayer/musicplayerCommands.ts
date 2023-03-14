import {
  CacheType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  SlashCommandBuilder,
  VoiceBasedChannel,
} from "discord.js";
import fs from "fs";
import os from "os";
import sqlite3 from "sqlite3";
import MusicPlayer from "./MusicPlayer";

let CACHE_ROOT = os.tmpdir();

process.argv.find((val, index) => {
  const splitVal = val.split("=");
  if (
    splitVal.length > 1 &&
    splitVal[0].trim() === "--cache" &&
    splitVal[1].length > 0
  ) {
    CACHE_ROOT = splitVal[1].trim();
  }
});

const CACHE_PATH = `${CACHE_ROOT}/PashaPlayer/cache`;
const STAGING_PATH = `${CACHE_PATH}/staging`;
const DB_PATH = `${CACHE_PATH}/cache.db`;

const db = new sqlite3.Database(DB_PATH);
db.run(
  "CREATE TABLE IF NOT EXISTS video_info (video_id TEXT PRIMARY KEY, info TEXT, insertion_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL)"
);

if (!fs.existsSync(CACHE_PATH)) {
  fs.mkdirSync(CACHE_PATH);
}

if (!fs.existsSync(STAGING_PATH)) {
  fs.mkdirSync(STAGING_PATH);
}

const musicPlayersByChannel: { [id: string]: MusicPlayer } = {};

const musicPlayerCheck = async (
  voiceChannel: VoiceBasedChannel,
  interaction: ChatInputCommandInteraction<CacheType>
) => {
  console.log("Music check", interaction.commandName);
  if (!musicPlayersByChannel[voiceChannel.id]) {
    await interaction.editReply(
      "You don't have any songs playing. Add songs to the queue with /play command."
    );
    return true;
  }
  console.log("Music check passed", interaction.commandName);
  return false;
};

export const playCommand = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song or add one to the queue.")
    .addStringOption((option) =>
      option.setName("url").setDescription("URL of song").setRequired(true)
    ),
  execute: async (interaction: ChatInputCommandInteraction<CacheType>) => {
    await interaction.deferReply();
    const username = interaction.user.username;
    const voiceChannel = (interaction.member as GuildMember).voice.channel;
    const textChannel = interaction.channel;
    const url = interaction.options.getString("url").trim();

    try {
      if (!musicPlayersByChannel[voiceChannel.id]) {
        musicPlayersByChannel[voiceChannel.id] = new MusicPlayer(
          voiceChannel,
          textChannel,
          db
        );
      }

      const musicPlayer = musicPlayersByChannel[voiceChannel.id];
      const info = await musicPlayer.getVideoInfo(url);
      await interaction.editReply(
        `:notes: Added **${info.title}** to the queue.`
      );
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
    } catch (err) {
      await interaction.editReply(`Error: ${err}`);
    }
  },
};

export const queueCommand = {
  data: new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Display the queued songs."),
  execute: async (interaction: ChatInputCommandInteraction<CacheType>) => {
    await interaction.deferReply();
    const voiceChannel = (interaction.member as GuildMember).voice.channel;
    if (await musicPlayerCheck(voiceChannel, interaction)) return;
    console.log("Getting queue");
    const musicPlayer = musicPlayersByChannel[voiceChannel.id];
    await interaction.editReply(await musicPlayer.getQueueStatus());
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
    await interaction.deferReply();
    const voiceChannel = (interaction.member as GuildMember).voice.channel;
    const from = interaction.options.getNumber("from");
    const to = interaction.options.getNumber("to", false) ?? 1;
    if (await musicPlayerCheck(voiceChannel, interaction)) return;

    const musicPlayer = musicPlayersByChannel[voiceChannel.id];
    try {
      musicPlayer.move(from, to);
    } catch (err) {
      await interaction.editReply(err.message);
      return;
    }
    const msgOptions = await musicPlayer.getQueueStatus();
    msgOptions.content = `Moved song in position ${from} to ${to}`;
    await interaction.editReply(msgOptions);
  },
};

export const removeCommand = {
  data: new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove a song from the queue")
    .addNumberOption((option) => {
      return option
        .setName("position")
        .setDescription("Queue order position of the song you'd like to remove")
        .setRequired(true);
    }),
  execute: async (interaction: ChatInputCommandInteraction<CacheType>) => {
    await interaction.deferReply();
    const voiceChannel = (interaction.member as GuildMember).voice.channel;
    const queuePosition = interaction.options.getNumber("position");
    if (await musicPlayerCheck(voiceChannel, interaction)) return;

    const musicPlayer = musicPlayersByChannel[voiceChannel.id];
    try {
      musicPlayer.remove(queuePosition);
    } catch (err) {
      await interaction.editReply(err.message);
      return;
    }
    const msgOptions = await musicPlayer.getQueueStatus();
    msgOptions.content = `Removed song from queue position ${queuePosition}`;
    await interaction.editReply(msgOptions);
  },
};

export const skipCommand = {
  data: new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Skip the currently playing song."),
  execute: async (interaction: ChatInputCommandInteraction<CacheType>) => {
    await interaction.deferReply();
    const voiceChannel = (interaction.member as GuildMember).voice.channel;
    if (await musicPlayerCheck(voiceChannel, interaction)) return;

    const musicPlayer = musicPlayersByChannel[voiceChannel.id];
    try {
      await interaction.editReply("Skipping song.");
      await musicPlayer.skip();
    } catch (err) {
      await interaction.editReply(err.message);
      return;
    }
  },
};

export const playingCommand = {
  data: new SlashCommandBuilder()
    .setName("playing")
    .setDescription("Check what song is currently playing."),
  execute: async (interaction: ChatInputCommandInteraction<CacheType>) => {
    await interaction.deferReply();
    const voiceChannel = (interaction.member as GuildMember).voice.channel;
    if (await musicPlayerCheck(voiceChannel, interaction)) return;

    const musicPlayer = musicPlayersByChannel[voiceChannel.id];
    try {
      await interaction.editReply(await musicPlayer.getNowPlayingStatus());
    } catch (err) {
      await interaction.editReply(err.message);
    }
  },
};

export const help = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Music player help."),
  execute: async (interaction: ChatInputCommandInteraction<CacheType>) => {
    interaction.reply({
      content: "",
      embeds: [
        new EmbedBuilder()
          .setColor("#33D7FF")
          .setTitle("/help")
          .setDescription(
            Object.values(commands)
              .map(
                (command) =>
                  `\`/${command.data.name}\`: ${command.data.description}`
              )
              .join("\n")
          ),
      ],
    });
  },
};

export const commands = {
  [playCommand.data.name]: playCommand,
  [queueCommand.data.name]: queueCommand,
  [playingCommand.data.name]: playingCommand,
  [removeCommand.data.name]: removeCommand,
  [moveCommand.data.name]: moveCommand,
  [skipCommand.data.name]: skipCommand,
  [help.data.name]: help,
};
function getVideoInfo(url: string) {
  throw new Error("Function not implemented.");
}
