const { Client, Intents } = require('discord.js');
const Discord = require('discord.js');
const fs = require('fs');
// Importing this allows you to access the environment variables of the running node process
require('dotenv').config();
const client = new Discord.Client({
    intents: [
        "GUILDS",
        "GUILD_MESSAGES",
        "DIRECT_MESSAGES",
        "GUILD_BANS",
        "GUILD_EMOJIS_AND_STICKERS",
        "GUILD_INTEGRATIONS",
        "GUILD_WEBHOOKS",
        "GUILD_INVITES",
        "GUILD_PRESENCES",
        "GUILD_MEMBERS"
    ],
    partials: [
        "CHANNEL"
    ] 
})

// 'process.env' accesses the environment variables for the running node process
const prefix = process.env.PREFIX;
const owner = process.env.OWNER;
const activities = [
    "<help | discord.koolkev246.com",
    "<help | koolkev246.com",
    "<help | invite.gg/GSMST",
    "<help | Managing x guilds!",
    "x servers | x members",
    "<help | x members",
    "<help | twitch.tv/Koolkev246",
    "<help | discord.gg/uE2Enuv",
    "twitch.tv/Koolkev246",
    "instagram.com/Koolkev246",
    "twitter.com/Koolkev246"
  ];
  // swap out the x's with their respective variables
client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  client.user.setActivity('<help | Cutie has awoken!', {type: "STREAMING", url: "https://www.twitch.tv/koolkev246"});
  setInterval(() => {
    const randomIndex = Math.floor(Math.random() * (activities.length - 1) + 1);
    const newActivity = activities[randomIndex];

    client.user.setActivity(newActivity, {type: "STREAMING",
    url: "https://www.twitch.tv/koolkev246"});
  }, 120000);
});

exports.commands = () => {
    return client.commands;
}

// add all commands
// todo: add error checking
// todo: add subfolder search support
let success = 0;
let fail = 0;
client.commands = [];
fs.readdir("./src/commands/", function(err, files){
    files.forEach(f => {
        const cmd = require(`./src/commands/${f}`);
        client.commands.push(cmd) ? success++ : fail++;
    });
});

console.log('Commands loaded.');

client.on('messageCreate', message =>{
	if (message.content == "hi"){
        if (message.author.bot) return;
        message.reply("whaddup!")
    }
	if(message.channel.type === 'dm'){
        message.channel.send("Pog");
    }
    if (!message.content.startsWith(prefix)) return;
    const args = message.content.slice(prefix.length).split(/ +/);
	const cmdName = args.shift().toLowerCase();
	client.commands.forEach(command => {
		if(cmdName === command.info.name || command.info.alias.includes(cmdName)){
            //guild or private chat check
            if(command.info.guildOnly && message.channel.type === 'dm'){
                message.channel.send("This command unavailable in private chat :^(");
                return;
            }

            //admin check
            if(command.info.permission == "owner"
                    && message.author.id != owner){
                message.channel.send("owner only command :^)");
            }
            if(command.info.permission == "admin")
            {

            }
			else{
                command.execute(client, message, args);
            }
        }
    });
});

// prob need a better error handler idk
process.on('unhandledRejection', error => {
	console.error('Unhandled promise rejection:', error);
});

console.log('Bot is ready!');

// attempts to login the bot with the environment variable you set for your bot token (either 'CLIENT_TOKEN' or 'DISCORD_TOKEN')
client.login();