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
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const discord_js_1 = require("discord.js");
const musicplayer_1 = require("./musicplayer");
const helloCommand = {
    data: new discord_js_1.SlashCommandBuilder()
        .setName("hello")
        .setDescription("Say hello to the bot"),
    execute: (interaction) => __awaiter(void 0, void 0, void 0, function* () {
        yield interaction.reply(`Don't bogard`);
    }),
};
const commands = {
    [musicplayer_1.playCommand.data.name]: musicplayer_1.playCommand,
    [helloCommand.data.name]: helloCommand,
};
const client = new discord_js_1.Client({
    intents: [discord_js_1.GatewayIntentBits.Guilds, discord_js_1.GatewayIntentBits.GuildVoiceStates],
});
// When the client is ready, run this code (only once)
// We use 'c' for the event parameter to keep it separate from the already defined 'client'
client.once(discord_js_1.Events.ClientReady, (c) => __awaiter(void 0, void 0, void 0, function* () {
    console.log(`Ready! Logged in as ${c.user.tag}`);
}));
client.on(discord_js_1.Events.InteractionCreate, (interaction) => __awaiter(void 0, void 0, void 0, function* () {
    // console.log(`Got interaction`, interaction);
    if (!interaction.isChatInputCommand())
        return;
    console.log(`Got interaction ${interaction.commandName}`);
    const command = commands[interaction.commandName];
    if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
    }
    try {
        yield command.execute(interaction);
    }
    catch (error) {
        console.error(error);
        if (interaction.replied || interaction.deferred) {
            yield interaction.followUp({
                content: "There was an error while executing this command!",
                ephemeral: true,
            });
        }
        else {
            yield interaction.reply({
                content: "There was an error while executing this command!",
                ephemeral: true,
            });
        }
    }
}));
//deploy commands
(() => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const rest = new discord_js_1.REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
        yield rest.put(discord_js_1.Routes.applicationGuildCommands(process.env.APP_ID, process.env.GUILD_ID), { body: Object.values(commands).map((command) => command.data.toJSON()) });
        console.log(`Successfully reloaded\n${Object.values(commands)
            .map((command) => `\t${command.data.name}`)
            .join("\n")}\napplication (/) commands.\n`);
    }
    catch (error) {
        console.error(error);
    }
}))();
// Log in to Discord with your client's token
client.login(process.env.DISCORD_TOKEN);
