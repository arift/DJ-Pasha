import { getArgv } from "./musicPlayer/utils";

const appId = getArgv("--appId");
const guildId = getArgv("--guildId");
const discordToken = getArgv("--discordToken");
const cacheDir = getArgv("--cacheDir") ?? "./cache";
const dbDir = getArgv("--dbDir") ?? "./db";
const cookie = getArgv("--cookie");

if (!appId || !guildId || !discordToken) {
    throw new Error(`Missing required arguments. Required: appId, guildId, discordToken`);
}
export {
    appId, cacheDir, cookie, dbDir, discordToken, guildId
};

