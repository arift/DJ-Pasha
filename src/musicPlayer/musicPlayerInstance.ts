import { VoiceBasedChannel } from "discord.js";
import MusicPlayer from "./MusicPlayer";

let currenPlayer: {
  musicPlayer: MusicPlayer;
  voiceChannel: VoiceBasedChannel;
} | null;

export const addMusicPlayer = (
  voiceChannel: VoiceBasedChannel,
  musicPlayer: MusicPlayer
) => {
  currenPlayer = { musicPlayer, voiceChannel };
};

export const hasMusicPlayer = () => {
  return Boolean(currenPlayer);
};

export const getMusicPlayer = () => {
  return currenPlayer;
};

export const removeMusicPlayer = () => {
  currenPlayer = null;
};
