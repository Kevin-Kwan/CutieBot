const { Client, Intents } = require('discord.js');
const Discord = require('discord.js');
const fs = require('fs');
// Importing this allows you to access the environment variables of the running node process
require('dotenv').config();
const client = new Discord.Client({
    intents: [
        "GUILDS",
        "GUILD_MESSAGES",
        "GUILD_MEMBERS"
    ]
})

// 'process.env' accesses the environment variables for the running node process
const prefix = process.env.PREFIX;

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  client.user.setActivity('You', {type: 'WATCHING'});
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
        message.reply("whaddup!")
		message.reply(prefix)
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
            if(command.info.permission == "admin"
                    && message.author.id != client.config.OWNER_ID){
                message.channel.send("Admin only command :^)");
            }
			else{
                command.execute(client, message, args);
            }
        }
    });
});
console.log('Bot is ready!');

// attempts to login the bot with the environment variable you set for your bot token (either 'CLIENT_TOKEN' or 'DISCORD_TOKEN')
client.login();