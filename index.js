const { Client, IntentsBitField, PermissionsBitField, EmbedBuilder, Partials , ActivityType } = require('discord.js');
const Discord = require('discord.js');
const fs = require('fs');

// Importing this allows you to access the environment variables of the running node process
require('dotenv').config();
const myIntents = new IntentsBitField();
myIntents.add(
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMembers,
    IntentsBitField.Flags.GuildBans,
    IntentsBitField.Flags.GuildEmojisAndStickers,
    IntentsBitField.Flags.GuildIntegrations,
    IntentsBitField.Flags.GuildWebhooks,
    IntentsBitField.Flags.GuildInvites,
    IntentsBitField.Flags.GuildVoiceStates,
    IntentsBitField.Flags.GuildPresences,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.GuildMessageReactions,
    IntentsBitField.Flags.GuildMessageTyping,
    IntentsBitField.Flags.DirectMessages,
    IntentsBitField.Flags.DirectMessageReactions,
    IntentsBitField.Flags.DirectMessageTyping,
    IntentsBitField.Flags.MessageContent,
    IntentsBitField.Flags.GuildScheduledEvents
    )
const client = new Client(
    { intents: myIntents },
    { partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction,
        Partials.User,
        Partials.GuildMember,
        Partials.GuildScheduledEvent,
        Partials.ThreadMember] });

// 'process.env' accesses the environment variables for the running node process
const prefix = process.env.PREFIX;
const owner = process.env.OWNER;
let usernum = client.guilds.cache.reduce((a, g) => a + g.memberCount, 0)
let guildnum = client.guilds.cache.size;
client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  storeNumbers();
  // 
  client.user.setActivity("" + prefix + "help | Cutie has awoken!", { type: ActivityType.Streaming, url: 'https://www.twitch.tv/KoolKev246' });
  setInterval(() => {
    storeNumbers();
    let activities = [
        //"<help | discord.koolkev246.com",
        "<help | koolkev246.com",
        //"<help | invite.gg/GSMST",
        "" + prefix + "help | Managing " + guildnum + " guilds!",
        "" + guildnum + " servers | " + usernum +" users",
        "" + prefix + "help | " + usernum + " users",
        "" + prefix + "help | " + process.env.TWITCH,
        //"<help | discord.gg/uE2Enuv",
        "" + process.env.TWITCH,
        "" + process.env.INSTAGRAM,
        "" + process.env.TWITTER
      ];
    const randomIndex = Math.floor(Math.random() * (activities.length - 1) + 1);
    const newActivity = activities[randomIndex];
    client.user.setActivity(newActivity, {type: ActivityType.Streaming, url: 'https://www.twitch.tv/KoolKev246' });
    //console.log(usernum+" users in "+guildnum+" guilds!");
  }, 120000);
  console.log(usernum+" users in "+guildnum+" guilds!");
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
// todo: log people's dms to bot
client.on('messageCreate', message =>{
	if (message.content == "hi"){
        if (message.author.bot) return;
        message.reply("whaddup!")
    }
    if (!message.content.startsWith(prefix)) return;
    const args = message.content.slice(prefix.length).split(/ +/);
	const cmdName = args.shift().toLowerCase();
	client.commands.forEach(command => {
		if(cmdName === command.info.name || command.info.alias.includes(cmdName)){
            //guild or private chat check
            if(command.info.guildOnly){
                message.channel.send("This command is unavailable in private chat :^(");
            }
            //admin check
            else if(command.info.permission == "owner" && message.author.id != owner){
                message.reply("sorry lil bro owner only command :^)");
            }
            else if(command.info.permission == "admin" && !message.member.permissionsIn(message.channel).has(PermissionsBitField.Flags.Administrator))
            {
                message.reply("sorry lil bro admin only command :^)");
            }
            else if(command.info.category == "NSFW" && !message.channel.nsfw)
            {
                const replyEmbed = new EmbedBuilder()
                    .setColor(Math.floor(Math.random() * 16777215).toString(16))
                    .setTitle('Error Retrieving Image!')
                    .setDescription('This command can only be used in an nsfw channel!')
                message.reply({ embeds: [replyEmbed] });
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
    // this conflicts with the ban command, needs debugging
});

function storeNumbers() {
usernum = client.guilds.cache.reduce((a, g) => a + g.memberCount, 0)
guildnum = client.guilds.cache.size;
}

function getUserFromMention(mention) {
	if (!mention) return;

	if (mention.startsWith('<@') && mention.endsWith('>')) {
		mention = mention.slice(2, -1);

		if (mention.startsWith('!')) {
			mention = mention.slice(1);
		}

		return client.users.cache.get(mention);
	}
}

// attempts to login the bot with the environment variable you set for your bot token (either 'CLIENT_TOKEN' or 'DISCORD_TOKEN')
client.login();
