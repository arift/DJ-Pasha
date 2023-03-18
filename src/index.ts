import {
  ButtonInteraction,
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
} from "discord.js";
import "dotenv/config";
import { commands, queuePageCommand } from "./musicPlayer/musicplayerCommands";
import { getArg } from "./musicPlayer/utils";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

// When the client is ready, run this code (only once)
// We use 'c' for the event parameter to keep it separate from the already defined 'client'
client.once(Events.ClientReady, async (c) => {
  console.log(`Ready! Logged in as ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton()) {
    console.log(
      `Got button interaction ${(interaction as ButtonInteraction).customId}`
    );
    const queuePageInteractionArg = getArg("--queuePage", [
      (interaction as ButtonInteraction).customId,
    ]);
    if (queuePageInteractionArg) {
      await queuePageCommand(interaction, Number(queuePageInteractionArg));
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  console.log(`Got interaction ${interaction.commandName}`);

  const command = commands[interaction.commandName];

  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found.`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: "There was an error while executing this command!",
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: "There was an error while executing this command!",
        ephemeral: true,
      });
    }
  }
});

//deploy commands
(async () => {
  try {
    const rest = new REST({ version: "10" }).setToken(
      process.env.DISCORD_TOKEN
    );

    await rest.put(
      Routes.applicationGuildCommands(process.env.APP_ID, process.env.GUILD_ID),
      { body: Object.values(commands).map((command) => command.data.toJSON()) }
    );

    console.log(
      `Successfully reloaded\n${Object.values(commands)
        .map((command) => `\t${command.data.name}`)
        .join("\n")}\napplication (/) commands.\n`
    );
  } catch (error) {
    console.error(error);
  }
})();

client.login(process.env.DISCORD_TOKEN);
