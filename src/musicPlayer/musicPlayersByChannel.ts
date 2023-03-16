import { VoiceBasedChannel } from "discord.js";
import MusicPlayer from "./MusicPlayer";

const musicPlayersByChannel: { [id: VoiceBasedChannel["id"]]: MusicPlayer } =
  {};

export const addMusicPlayer = (
  voiceChannel: VoiceBasedChannel,
  musicPlayer: MusicPlayer
) => {
  musicPlayersByChannel[voiceChannel.id] = musicPlayer;
};

export const hasMusicPlayer = (voiceChannel: VoiceBasedChannel) => {
  return Boolean(musicPlayersByChannel[voiceChannel.id]);
};

export const getMusicPlayer = (voiceChannel: VoiceBasedChannel) => {
  return musicPlayersByChannel[voiceChannel.id];
};

export const removeMusicPlayer = (voiceChannel: VoiceBasedChannel) => {
  delete musicPlayersByChannel[voiceChannel.id];
};
