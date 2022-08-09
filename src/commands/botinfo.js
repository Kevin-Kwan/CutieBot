/*
    Command that returns the bot's information
*/
const { EmbedBuilder } = require('discord.js');
const osu = require('node-os-utils');
const cpu = osu.cpu;
var cpuUsage;


const prefix = process.env.PREFIX;
const owner = process.env.OWNER;
const websiteURL = process.env.WEBSITE_URL;
var version = '0.0.1';
// get the bot's name without tag and store into botName
var botName;
var botDescription = "A Discord bot coded running on Node.js! The project started in 2017, but was later too outdated. Thus, this bot aims to serve as version 2.";
var botOwner;
var botRepo = process.env.GITHUB_REPO;
var botRamUsage;
var botPing;
var guildAmount;
var userAmount;
var emojiAmount;

var invite = 'https://discord.com/oauth2/authorize?client_id=927315876036898866&permissions=8&scope=bot'
module.exports.execute = (client, message, args) => {
    botName = client.user.username;
    botOwner = client.users.cache.get(owner);
    //botOwnerAvatar = client.users.cache.get(owner).avatarURL();
    let totalSeconds = (client.uptime / 1000);
    let days = Math.floor(totalSeconds / 86400);
    totalSeconds %= 86400;
    let hours = Math.floor(totalSeconds / 3600);
    totalSeconds %= 3600;
    let minutes = Math.floor(totalSeconds / 60);
    let seconds = Math.floor(totalSeconds % 60);
    // get the bot's ram usage in GB and store into botRamUsage
    botRamUsage = Math.round(process.memoryUsage().heapUsed / 1024 / 1024 / 1024 * 100) / 100;
    // get the bot's cpu usage as a percentage to the hundredths place and store into botCpuUsage using cpu.loadavgTime()
    cpuUsage = (cpu.loadavgTime() / 2) * 10;
    botPing = client.ws.ping;
    guildAmount = client.guilds.cache.size;
    userAmount = client.users.cache.size;
    emojiAmount = client.emojis.cache.size;

    // create the embed to send to the channel
    const embed = new EmbedBuilder()
        // set random color
        .setColor(Math.floor(Math.random() * 16777215).toString(16))
        .setTitle('Bot Information')
        .setDescription(botDescription)
        //set url
        .setURL(botRepo)
        .setAuthor({name: 'Bot Owner: '+(botOwner.tag).toString() , url: websiteURL.toString() , iconURL: botOwner.avatarURL()})
        .addFields(
            {name: 'Bot Name', value: botName.toString(), inline: true},
            {name: 'Bot Prefix', value: prefix.toString(), inline: true},
            {name: 'Bot Repository', value: botRepo.toString(), inline: true},
            {name: 'Bot Ram Usage', value: botRamUsage.toString()+' GB', inline: true},
            {name: 'Bot CPU Usage', value: cpuUsage.toString()+'%', inline: true},
            {name: 'Bot Ping', value: botPing.toString()+' ms', inline: true},
            {name: 'Bot Guild Amount', value: guildAmount.toString(), inline: true},
            {name: 'Bot User Amount', value: userAmount.toString(), inline: true},
            {name: 'Bot Emoji Amount', value: emojiAmount.toString(), inline: true},
            //{name: 'Uptime', value: `${days} days, ${hours} hours, ${minutes} minutes, ${seconds} seconds`, inline: true},
        )
        .setTimestamp()
        //.setFooter(`Version: ${version} | ${days} days, ${hours} hours, ${minutes} minutes, ${seconds} seconds | Ping: ${botPing}ms`);
    
    // send the embed to the channel
    message.reply({embeds: [embed]});

    
};

module.exports.info = {
    name: "botinfo",
    alias: ["infobot", "bot"],
    permission: "default",
    category: "general",
    guildOnly: false,
	help: "command to get the bot's information"
};