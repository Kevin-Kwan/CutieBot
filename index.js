const { Client, Intents } = require('discord.js');
const Discord = require('discord.js');
// Importing this allows you to access the environment variables of the running node process
require("dotenv").config();
const myIntents = new Intents();
myIntents.add(Intents.FLAGS.GUILD_MEMBERS, Intents.FLAGS.GUILDS);
const client = new Client({ intents: myIntents });

// "process.env" accesses the environment variables for the running node process. PREFIX is the environment variable you defined in your .env file
const prefix = process.env.PREFIX;

client.on("ready", () => {
  console.log(`Logged in as ${client.user.tag}!`);
    client.user.setActivity('yo', {type: 'WATCHING'});
});

client.commands = new Discord.Collection();

const commandFolders = fs.readdirSync('./commands');

for (const folder of commandFolders) {
	const commandFiles = fs.readdirSync(`./src/commands/${folder}`).filter(file => file.endsWith('.js'));
	for (const file of commandFiles) {
		const command = require(`./src/commands/${folder}/${file}`);
		client.commands.set(command.name, command);
	}
}

// Here you can login the bot. It automatically attempts to login the bot with the environment variable you set for your bot token (either "CLIENT_TOKEN" or "DISCORD_TOKEN")
client.login();