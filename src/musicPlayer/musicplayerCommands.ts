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
  VoiceBasedChannel,
} from "discord.js";
import ytdl from "ytdl-core";
import ytpl from "ytpl";
import { getInfo, getPlaylistInfo, getTopPlayers } from "./MetaEngine";
import MusicPlayer from "./MusicPlayer";
import {
  addMusicPlayer,
  getMusicPlayer,
  hasMusicPlayer,
} from "./musicPlayersByChannel";
import { SavedInfo } from "./types";

const musicPlayerCheck = async (
  voiceChannel: VoiceBasedChannel,
  interaction: ChatInputCommandInteraction<CacheType> | ButtonInteraction
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
    const nickname = (interaction.member as GuildMember).nickname;
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
          new MusicPlayer(voiceChannel, textChannel, client)
        );
        textChannel.send(
          `:mirror_ball: :fire: DJ Pasha is in the house! :fire: :mirror_ball:`
        );
      }

      const musicPlayer = getMusicPlayer(voiceChannel);
      //check if it's playlist
      if (ytpl.validateID(url)) {
        const playlistId = await ytpl.getPlaylistID(url);
        const playlist = await getPlaylistInfo(playlistId);

        musicPlayer.addSong(
          playlist.items.map((item) => ({
            id: ytdl.getVideoID(item.shortUrl),
            url: item.shortUrl,
            by: username,
            byNickname: nickname,
          }))
        );

        await interaction.editReply(
          `:notes: Added **${playlist.title}** playlist to the queue with ${playlist.items.length} songs.`
        );
      } else if (ytdl.validateURL(url)) {
        //single song
        const id = ytdl.getVideoID(url);
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
          url,
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
      const voiceChannel = (interaction.member as GuildMember).voice.channel;
      if (await musicPlayerCheck(voiceChannel, interaction)) return;
      const musicPlayer = getMusicPlayer(voiceChannel);
      await interaction.editReply(await musicPlayer.getQueueStatus());
    } catch (err) {
      console.error("Error in queue: ", err);
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

export const statsCommand = {
  data: new SlashCommandBuilder()
    .setName("stats")
    .setDescription(
      "Show some stats to settle once and for all who is bogarting the music bot."
    ),
  execute: async (interaction: ChatInputCommandInteraction<CacheType>) => {
    try {
      await interaction.deferReply();
      const embed = new EmbedBuilder()
        .setColor("#33D7FF")
        .setTitle("Select stat range:");
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

      const collector = interaction.channel.createMessageComponentCollector({
        filter: (i) => i.customId.includes("stat."),
      });

      collector.on("collect", async (buttonInteraction: ButtonInteraction) => {
        await buttonInteraction.deferUpdate();
        try {
          console.log("Collected page");
          let stats: Awaited<ReturnType<typeof getTopPlayers>>;

          //reset buttons back to primary
          buttons.forEach((btn) => btn.setDisabled(false));
          let title: string;
          switch (buttonInteraction.customId) {
            case "stat.24hr":
              stats = await getTopPlayers(1);
              title = "Past 24 Hours:";
              stat24Hr.setDisabled(true);
              break;
            case "stat.week":
              stats = await getTopPlayers(7);
              title = "Past 7 Days:";
              statWeek.setDisabled(true);
              break;
            case "stat.month":
              title = "Past Month:";
              stats = await getTopPlayers(30);
              statMonth.setDisabled(true);
              break;
            case "stat.year":
              title = "Past Year:";
              stats = await getTopPlayers(365);
              statYear.setDisabled(true);
              break;
            case "stat.all":
              title = "All Time:";
              stats = await getTopPlayers();
              statAll.setDisabled(true);
              break;
          }
          await buttonInteraction.editReply({
            content: "Top Bogarters",
            embeds: [
              embed
                .setDescription(
                  stats
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
                      return `${idx + 1} - ${emoji}${stat.username}: ${
                        stat.playCount
                      }`;
                    })
                    .join("\n")
                )
                .setTitle(title),
            ],
            components: [
              new ActionRowBuilder<ButtonBuilder>().addComponents(
                stat24Hr,
                statWeek,
                statMonth,
                statYear,
                statAll
              ),
            ],
          });
        } catch (err) {
          console.error("Generate stats error: ", err);
          await buttonInteraction.editReply(
            "Problem generating stats. Complain to nutnut."
          );
        }
      });

      await interaction.editReply({
        content: "Stats",
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            stat24Hr,
            statWeek,
            statMonth,
            statYear,
            statAll
          ),
        ],
      });
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
  // [statsCommand.data.name]: statsCommand,
  [help.data.name]: help,
};
