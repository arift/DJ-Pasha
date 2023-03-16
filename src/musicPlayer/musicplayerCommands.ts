import {
  CacheType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  SlashCommandBuilder,
  VoiceBasedChannel,
} from "discord.js";
import { db } from "./cache";
import MusicPlayer, { SavedInfo } from "./MusicPlayer";
import {
  addMusicPlayer,
  getMusicPlayer,
  hasMusicPlayer,
} from "./musicPlayersByChannel";

const musicPlayerCheck = async (
  voiceChannel: VoiceBasedChannel,
  interaction: ChatInputCommandInteraction<CacheType>
) => {
  if (!hasMusicPlayer(voiceChannel)) {
    await interaction.editReply(
      "You don't have any songs playing. Add songs to the queue with /play command."
    );
    return true;
  }
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
    const client = interaction.client;
    const username = interaction.user.username;
    const voiceChannel = (interaction.member as GuildMember).voice.channel;
    const textChannel = interaction.channel;
    const url = interaction.options.getString("url").trim();

    if (!voiceChannel) {
      await interaction.editReply(
        `:warning: You must be in a voice channel to use DJ Pasha!`
      );
      return;
    }
    try {
      if (!hasMusicPlayer(voiceChannel)) {
        addMusicPlayer(
          voiceChannel,
          new MusicPlayer(voiceChannel, textChannel, db, client)
        );
      }

      const musicPlayer = getMusicPlayer(voiceChannel);
      let info: SavedInfo;
      try {
        info = await musicPlayer.getVideoInfo(url);
      } catch (err) {
        console.error("Error while getting info: ", err);
        await interaction.editReply(`${err}`);
        return;
      }
      musicPlayer.addSong({ url, by: username });
      let msg = `:notes: Added **${info.title}** to the queue. `;
      if (musicPlayer.playing && musicPlayer.queueu.length > 0) {
        msg += `Place in queue: ${musicPlayer.queueu.length}.`;
      }
      await interaction.editReply(msg);

      if (!musicPlayer.playing) {
        try {
          await musicPlayer.playNextSong();
        } catch (err) {
          console.error(err);
          await interaction.editReply(`Error: ${err}`);
          return;
        }
      }
    } catch (err) {
      console.error(err);
      await interaction.editReply(`Error: ${err}`);
    }
  },
};

export const queueCommand = {
  data: new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Display the queued songs."),
  execute: async (interaction: ChatInputCommandInteraction<CacheType>) => {
    try {
      await interaction.deferReply();
      const voiceChannel = (interaction.member as GuildMember).voice.channel;
      if (await musicPlayerCheck(voiceChannel, interaction)) return;

      const musicPlayer = getMusicPlayer(voiceChannel);
      await interaction.editReply(await musicPlayer.getQueueStatus());
    } catch (err) {
      console.error(err);
      await interaction.editReply(`Error: ${err}`);
    }
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
    try {
      await interaction.deferReply();
      const voiceChannel = (interaction.member as GuildMember).voice.channel;
      if (await musicPlayerCheck(voiceChannel, interaction)) return;

      const from = interaction.options.getNumber("from");
      const to = interaction.options.getNumber("to", false) ?? 1;
      const musicPlayer = getMusicPlayer(voiceChannel);
      musicPlayer.move(from, to);
      const msgOptions = await musicPlayer.getQueueStatus();
      msgOptions.content = `Moved song in position ${from} to ${to}`;
      await interaction.editReply(msgOptions);
    } catch (err) {
      await interaction.editReply(err.message);
      console.error(err);
      return;
    }
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
    try {
      await interaction.deferReply();
      const voiceChannel = (interaction.member as GuildMember).voice.channel;
      const queuePosition = interaction.options.getNumber("position");
      if (await musicPlayerCheck(voiceChannel, interaction)) return;

      const musicPlayer = getMusicPlayer(voiceChannel);
      musicPlayer.remove(queuePosition);
      const msgOptions = await musicPlayer.getQueueStatus();
      msgOptions.content = `Removed song from queue position ${queuePosition}`;
      await interaction.editReply(msgOptions);
    } catch (err) {
      await interaction.editReply(err.message);
      console.error(err);
      return;
    }
  },
};

export const skipCommand = {
  data: new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Skip the currently playing song."),
  execute: async (interaction: ChatInputCommandInteraction<CacheType>) => {
    try {
      await interaction.deferReply();
      const voiceChannel = (interaction.member as GuildMember).voice.channel;
      if (await musicPlayerCheck(voiceChannel, interaction)) return;

      const musicPlayer = getMusicPlayer(voiceChannel);
      await musicPlayer.skip();
      await interaction.editReply("Skipped song.");
    } catch (err) {
      await interaction.editReply(err.message);
      console.error(err);
      return;
    }
  },
};

export const shuffleCommand = {
  data: new SlashCommandBuilder()
    .setName("shuffle")
    .setDescription("Shuffle the queue."),
  execute: async (interaction: ChatInputCommandInteraction<CacheType>) => {
    try {
      await interaction.deferReply();
      const voiceChannel = (interaction.member as GuildMember).voice.channel;
      if (await musicPlayerCheck(voiceChannel, interaction)) return;

      const musicPlayer = getMusicPlayer(voiceChannel);
      musicPlayer.shuffle();

      const msgOptions = await musicPlayer.getQueueStatus();
      msgOptions.content = `Shuffled the queue.`;
      await interaction.editReply(msgOptions);
    } catch (err) {
      await interaction.editReply(err.message);
      console.error(err);
      return;
    }
  },
};

export const playingCommand = {
  data: new SlashCommandBuilder()
    .setName("playing")
    .setDescription("Check what song is currently playing."),
  execute: async (interaction: ChatInputCommandInteraction<CacheType>) => {
    try {
      await interaction.deferReply();
      const voiceChannel = (interaction.member as GuildMember).voice.channel;
      if (await musicPlayerCheck(voiceChannel, interaction)) return;

      const musicPlayer = getMusicPlayer(voiceChannel);
      await interaction.editReply(await musicPlayer.getNowPlayingStatus());
    } catch (err) {
      await interaction.editReply(err.message);
      console.error(err);
      return;
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
  [shuffleCommand.data.name]: shuffleCommand,
  [skipCommand.data.name]: skipCommand,
  [help.data.name]: help,
};
