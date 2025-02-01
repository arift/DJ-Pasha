import ytdl from "@distube/ytdl-core";
import { endOfDay, startOfDay, sub } from "date-fns";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  CacheType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  SlashCommandBuilder,
} from "discord.js";
import ytpl from "ytpl";
import metaEngine from "./MetaEngine";
import MusicPlayer from "./MusicPlayer";
import {
  addMusicPlayer,
  getMusicPlayer,
  hasMusicPlayer,
} from "./musicPlayerInstance";
import { SavedInfo } from "./types";

const musicPlayerCheck = async (
  interaction: ChatInputCommandInteraction<CacheType> | ButtonInteraction
) => {
  if (!hasMusicPlayer()) {
    await interaction.editReply(
      "You don't have any songs playing. Add songs to the queue with /play command."
    );
    return true;
  }
  return false;
};

const { generatePlayStatsText, getInfo, getPlaylistInfo } = metaEngine;

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
    const nickname = (interaction.member as GuildMember).nickname;
    const voiceChannel = (interaction.member as GuildMember).voice.channel;
    const textChannel = interaction.channel;
    const url = interaction.options?.getString("url")?.trim();

    let firstTimeText: string;
    if (!voiceChannel) {
      await interaction.editReply(
        `:warning: You must be in a voice channel to use DJ Pasha!`
      );
      console.log("Not in voice chat.");
      return;
    }
    try {
      const existingMusicPlayer = getMusicPlayer();
      if (!existingMusicPlayer) {
        addMusicPlayer(
          voiceChannel,
          new MusicPlayer(voiceChannel, textChannel, client)
        );
        firstTimeText = `:mirror_ball: :fire: DJ Pasha is in the house! :fire: :mirror_ball:`;
      } else if (
        existingMusicPlayer &&
        existingMusicPlayer.voiceChannel.id !== voiceChannel.id
      ) {
        await interaction.editReply(
          `:warning: DJ Pasha is in a different voice channel. You can only have it in one channel at a time (Discord rules)`
        );
        return;
      }

      const currenPlayer = getMusicPlayer();
      if (!currenPlayer) throw new Error("No music player");
      const { musicPlayer } = currenPlayer;
      //check if it's playlist
      if (ytpl.validateID(url ?? "")) {
        const playlistId = await ytpl.getPlaylistID(url!);
        const playlist = await getPlaylistInfo(playlistId);
        if (!playlist) {
          await interaction.editReply(
            `:face_palm: Couldn't get playlist info. Is it private? ${url}`
          );
          return;
        }
        musicPlayer.addSong(
          playlist.items.map((item) => ({
            id: ytdl.getVideoID(item.shortUrl),
            url: item.shortUrl,
            by: username,
            byNickname: nickname,
          }))
        );

        await interaction.editReply(
          `${firstTimeText! ? `${firstTimeText}\n\n` : ""}:notes: Added **${playlist.title
          }** playlist to the queue with ${playlist.items.length} songs.`
        );
      } else if (ytdl.validateURL(url!)) {
        //single song
        const id = ytdl.getVideoID(url!);
        let info: SavedInfo;
        try {
          info = await getInfo(id);
        } catch (err) {
          console.error("Error while getting info: ", err);
          await interaction.editReply(`${err}`);
          return;
        }
        musicPlayer.addSong({
          id,
          url: url!,
          by: username,
          byNickname: nickname,
        });
        let msg = `:notes: Added **${info.title}** to the queue. `;
        if (musicPlayer.playing && musicPlayer.queue.size() > 0) {
          msg += `Place in queue: ${musicPlayer.queue.size()}.`;
        }
        await interaction.editReply(msg);
      } else {
        await interaction.editReply(
          `:face_palm: Not a valid URL. Use either a video link or a playlist link. What is this shit? ${url}`
        );
        return;
      }

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
      if (await musicPlayerCheck(interaction)) return;
      const player = getMusicPlayer();
      if (!player) throw new Error("Missing player");
      const { musicPlayer } = player;
      await interaction.editReply(await musicPlayer.getQueueStatus());
    } catch (err) {
      console.error("Error in queue: ", err);
      await interaction.editReply(`Error: ${err}`);
    }
  },
};

export const moveCommand = {
  data: new SlashCommandBuilder()
    .setName("move")
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
      if (await musicPlayerCheck(interaction)) return;

      const from = interaction.options.getNumber("from");
      const to = interaction.options.getNumber("to", false) ?? 1;
      const player = getMusicPlayer();
      if (!player) throw new Error("Missing player");
      const { musicPlayer } = player;
      if (from === null) throw new Error("Missing from");
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

export const clearCommand = {
  data: new SlashCommandBuilder()
    .setName("clear")
    .setDescription(
      "Clear the queue. Leave `from` and `to` empty to clear the entire queue"
    )
    .addNumberOption((option) => {
      return option
        .setName("from")
        .setDescription("from queue spot")
        .setRequired(false);
    })
    .addNumberOption((option) => {
      return option
        .setName("to")
        .setDescription(
          "to queue spot (leave empty to delete all the way to the end)"
        )
        .setRequired(false);
    }),
  execute: async (interaction: ChatInputCommandInteraction<CacheType>) => {
    try {
      await interaction.deferReply();
      if (await musicPlayerCheck(interaction)) return;
      const from = interaction.options.getNumber("from", false);
      const to = interaction.options.getNumber("to", false);
      let fromIdx: number | undefined;
      let toIdx: number | undefined;
      let reply = "Queue cleared";
      if (typeof from === "number") {
        fromIdx = from - 1;
        reply += ` from ${from}`;
        if (typeof to === "number") {
          toIdx = to - 1;
          reply += ` to ${to}`;
        } else {
          reply += ` until end of queue.`;
        }
      }
      reply += ".";
      const player = getMusicPlayer();
      if (!player) throw new Error("Missing player");
      const { musicPlayer } = player;
      musicPlayer.clear(fromIdx, toIdx);

      await interaction.editReply(reply);
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
      const queuePosition = interaction.options.getNumber("position");
      if (await musicPlayerCheck(interaction)) return;

      const player = getMusicPlayer();
      if (!player) throw new Error("Missing player");
      const { musicPlayer } = player;

      if (!queuePosition) throw new Error("Missing queue position");

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
      if (await musicPlayerCheck(interaction)) return;

      const player = getMusicPlayer();
      if (!player) throw new Error("Missing player");
      const { musicPlayer } = player;

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
      if (await musicPlayerCheck(interaction)) return;

      const player = getMusicPlayer();
      if (!player) throw new Error("Missing player");
      const { musicPlayer } = player;

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
      if (await musicPlayerCheck(interaction)) return;

      const player = getMusicPlayer();
      if (!player) throw new Error("Missing player");
      const { musicPlayer } = player;

      await interaction.editReply(await musicPlayer.getNowPlayingStatus());
    } catch (err) {
      await interaction.editReply(err.message);
      console.error(err);
      return;
    }
  },
};

export const repeatCommand = {
  data: new SlashCommandBuilder()
    .setName("repeat")
    .setDescription("Turn on/off repeating the currently playing song."),
  execute: async (interaction: ChatInputCommandInteraction<CacheType>) => {
    try {
      await interaction.deferReply();
      if (await musicPlayerCheck(interaction)) return;

      const player = getMusicPlayer();
      if (!player) throw new Error("Missing player");
      const { musicPlayer } = player;

      musicPlayer.setRepeat(!musicPlayer.repeatingSong);

      await interaction.editReply(
        `Repeat toggled to ${musicPlayer.repeatingSong ? "On" : "Off"}`
      );
    } catch (err) {
      await interaction.editReply(err.message);
      console.error(err);
      return;
    }
  },
};

export const statsCommand = {
  data: new SlashCommandBuilder()
    .setName("stats")
    .setDescription(
      "Show some stats to settle once and for all who is bogarting the music bot."
    ),
  execute: async (interaction: ChatInputCommandInteraction<CacheType>) => {
    try {
      await interaction.deferReply();

      const stat24Hr = new ButtonBuilder()
        .setCustomId(`stat.24hr`)
        .setStyle(ButtonStyle.Primary)
        .setLabel(`24 Hours`);

      const statWeek = new ButtonBuilder()
        .setCustomId(`stat.week`)
        .setStyle(ButtonStyle.Primary)
        .setLabel(`Week`);

      const statMonth = new ButtonBuilder()
        .setCustomId(`stat.month`)
        .setStyle(ButtonStyle.Primary)
        .setLabel(`Month`);

      const statYear = new ButtonBuilder()
        .setCustomId(`stat.year`)
        .setStyle(ButtonStyle.Primary)
        .setLabel(`Year`);

      const statAll = new ButtonBuilder()
        .setCustomId(`stat.all`)
        .setStyle(ButtonStyle.Primary)
        .setLabel(`All Time`);
      const buttons = [stat24Hr, statWeek, statMonth, statYear, statAll];

      if (!interaction.channel) throw new Error("No channel");

      const collector = interaction.channel.createMessageComponentCollector({
        filter: (i) => i.customId.includes("stat."),
      });

      const getStatReply = async (rangeId) => {
        buttons.forEach((btn) => btn.setDisabled(false));
        let startDate: Date;
        let endDate: Date;
        switch (rangeId) {
          case "stat.24hr":
            stat24Hr.setDisabled(true);
            startDate = startOfDay(sub(new Date(), { days: 1 }));
            endDate = endOfDay(new Date());
            break;
          case "stat.week":
            statWeek.setDisabled(true);
            startDate = startOfDay(sub(new Date(), { days: 7 }));
            endDate = endOfDay(new Date());
            break;
          case "stat.month":
            statMonth.setDisabled(true);
            startDate = startOfDay(sub(new Date(), { months: 1 }));
            endDate = endOfDay(new Date());
            break;
          case "stat.year":
            statYear.setDisabled(true);
            startDate = startOfDay(sub(new Date(), { years: 1 }));
            endDate = endOfDay(new Date());
            break;
          case "stat.all":
            statAll.setDisabled(true);
            break;
        }

        const reply = {
          content: `${await generatePlayStatsText(startDate!, endDate!)}\n`,

          components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              stat24Hr,
              statWeek,
              statMonth,
              statYear,
              statAll
            ),
          ],
        };

        return reply;
      };

      collector.on("collect", async (buttonInteraction: ButtonInteraction) => {
        await buttonInteraction.deferUpdate();
        try {
          await buttonInteraction.editReply(
            await getStatReply(buttonInteraction.customId)
          );
        } catch (err) {
          console.error("Generate stats error: ", err);
          await buttonInteraction.editReply(
            "Problem generating stats. Complain to nutnut."
          );
        }
      });

      await interaction.editReply(await getStatReply("stat.week"));
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
    await interaction.reply({
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
  [clearCommand.data.name]: clearCommand,
  [moveCommand.data.name]: moveCommand,
  [shuffleCommand.data.name]: shuffleCommand,
  [skipCommand.data.name]: skipCommand,
  [repeatCommand.data.name]: repeatCommand,
  [statsCommand.data.name]: statsCommand,
  [help.data.name]: help,
};
