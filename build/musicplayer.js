"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.playCommand = void 0;
const voice_1 = require("@discordjs/voice");
const crypto_1 = __importDefault(require("crypto"));
const discord_js_1 = require("discord.js");
const fs_1 = __importDefault(require("fs"));
const ytdl_core_1 = __importDefault(require("ytdl-core"));
const musicPlayersByChannel = {};
class MusicPlayer {
    constructor(channel) {
        this.playList = [];
        this.playing = false;
        this.channel = channel;
        this.voiceConnection = (0, voice_1.joinVoiceChannel)({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
        });
        this.audioPlayer = (0, voice_1.createAudioPlayer)();
        this.voiceConnection.subscribe(this.audioPlayer);
    }
    addSong(url) {
        console.log("added song to the queue ", url);
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
            }
            else {
                this.playUrl(url);
            }
        };
        playNextSong();
        this.audioPlayer.on(voice_1.AudioPlayerStatus.Idle, () => {
            console.log("In idle, playing next song");
            playNextSong();
        });
    }
    playFromCache(path) {
        this.audioPlayer.play((0, voice_1.createAudioResource)(path));
    }
    playUrl(url) {
        const musicPlayer = this;
        console.log("Playing url next", url);
        const urlHash = crypto_1.default.createHash("sha1").update(url).digest("hex");
        const cachePath = `./cache/${urlHash}.webm`;
        if (fs_1.default.existsSync(cachePath)) {
            this.playFromCache(cachePath);
        }
        else {
            console.log("Song not in cache. Downloading it from ytdl");
            const ytStream = (0, ytdl_core_1.default)(url, { filter: "audioonly", quality: "251" });
            const stagingPath = `./cache/.staging/${urlHash}.webm`;
            ytStream.pipe(fs_1.default.createWriteStream(stagingPath));
            ytStream.on("end", function (args) {
                fs_1.default.renameSync(stagingPath, cachePath);
                console.log("Downloaded song. Playing it!");
                musicPlayer.playFromCache(cachePath);
            });
        }
    }
}
exports.playCommand = {
    data: new discord_js_1.SlashCommandBuilder()
        .setName("play")
        .setDescription("Plays a song.")
        .addStringOption((option) => option.setName("url").setDescription("URL of song").setRequired(true)),
    execute: (interaction) => __awaiter(void 0, void 0, void 0, function* () {
        const channel = interaction.member.voice.channel;
        const url = interaction.options.getString("url").trim();
        if (!musicPlayersByChannel[channel.id]) {
            musicPlayersByChannel[channel.id] = new MusicPlayer(channel);
        }
        const musicPlayer = musicPlayersByChannel[channel.id];
        musicPlayer.addSong(url);
        if (!musicPlayer.playing) {
            musicPlayer.play();
        }
        // interaction.guild is the object representing the Guild in which the command was run
        yield interaction.reply(`Added song to the queue.`);
    }),
};
