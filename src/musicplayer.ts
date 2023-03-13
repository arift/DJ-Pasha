import {
  AudioPlayer,
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  joinVoiceChannel,
  VoiceConnection,
} from "@discordjs/voice";
import crypto from "crypto";
import {
  CacheType,
  ChatInputCommandInteraction,
  GuildMember,
  SlashCommandBuilder,
  VoiceBasedChannel,
} from "discord.js";
import fs from "fs";
import ytdl from "ytdl-core";

const musicPlayersByChannel: { [id: string]: MusicPlayer } = {};

class MusicPlayer {
  channel: VoiceBasedChannel;
  audioPlayer: AudioPlayer;
  voiceConnection: VoiceConnection;
  playList = [];
  playing = false;

  constructor(channel: VoiceBasedChannel) {
    this.channel = channel;
    this.voiceConnection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
    });
    this.audioPlayer = createAudioPlayer();
    this.voiceConnection.subscribe(this.audioPlayer);
  }

  addSong(url: string) {
    console.log("Added song to the queue ", url);
    this.playList.push(url);
  }

  play() {
    this.playing = true;
    const playNextSong = () => {
      console.log("Playing next song");
      const url = this.playList.shift();
      if (!url) {
        console.log("No new song. Stopping play");
        this.playing = false;
      } else {
        this.playUrl(url);
      }
    };

    playNextSong();

    this.audioPlayer.on(AudioPlayerStatus.Idle, () => {
      console.log("In idle, playing next song");
      playNextSong();
    });
  }

  playFromCache(path: string) {
    this.audioPlayer.play(createAudioResource(path));
  }

  playUrl(url: string) {
    const musicPlayer = this;
    console.log("Playing url next", url);
    const urlHash = crypto.createHash("sha1").update(url).digest("hex");
    const cachePath = `./cache/${urlHash}.webm`;
    if (fs.existsSync(cachePath)) {
      this.playFromCache(cachePath);
    } else {
      console.log("Song not in cache. Downloading it from ytdl");
      if (!ytdl.validateURL(url)) {
        throw new Error("Not a valid url: " + url);
      }
      const ytStream = ytdl(url, { filter: "audioonly", quality: "251" });
      const stagingPath = `./cache/.staging/${urlHash}.webm`;
      ytStream.pipe(fs.createWriteStream(stagingPath));
      ytStream.on("end", function (args) {
        try {
          fs.renameSync(stagingPath, cachePath);
        } catch (err) {
          console.error("Renaming from staging to cache failed", err);
        }
        console.log("Downloaded song. Playing it!");
        musicPlayer.playFromCache(cachePath);
      });
    }
  }
}

export const playCommand = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Plays a song.")
    .addStringOption((option) =>
      option.setName("url").setDescription("URL of song").setRequired(true)
    ),
  execute: async (interaction: ChatInputCommandInteraction<CacheType>) => {
    const channel = (interaction.member as GuildMember).voice.channel;
    const url = interaction.options.getString("url").trim();

    if (!musicPlayersByChannel[channel.id]) {
      musicPlayersByChannel[channel.id] = new MusicPlayer(channel);
    }

    const musicPlayer = musicPlayersByChannel[channel.id];
    musicPlayer.addSong(url);
    if (!musicPlayer.playing) {
      try {
        musicPlayer.play();
      } catch (error) {
        console.error("music player error", error);
      }
    }

    // interaction.guild is the object representing the Guild in which the command was run
    await interaction.reply(`Added song to the queue.`);
  },
};
