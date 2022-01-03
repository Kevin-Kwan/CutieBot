const { Client } = require("discord.js");
// Importing this allows you to access the environment variables of the running node process
require("dotenv").config();

const client = new Client();

// "process.env" accesses the environment variables for the running node process. PREFIX is the environment variable you defined in your .env file
const prefix = process.env.PREFIX;

client.on("ready", () => {
  console.log(`Logged in as ${client.user.tag}!`);
    client.user.setActivity('yo', {type: 'WATCHING'});
});

client.on("messageCreate", message => {

  // Here's I'm using one of An Idiot's Guide's basic command handlers. Using the PREFIX environment variable above, I can do the same as the bot token below
  if (message.author.bot) return;
  if (message.content.indexOf(prefix.length) !== 0) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/g);
  const command = args.shift().toLowerCase();

  if (command === "ping") {
    message.reply("Pong!");
  }
});

// Here you can login the bot. It automatically attempts to login the bot with the environment variable you set for your bot token (either "CLIENT_TOKEN" or "DISCORD_TOKEN")
client.login();