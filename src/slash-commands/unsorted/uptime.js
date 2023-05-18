/*
    Command that returns the bot's uptime
*/
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('uptime')
        .setDescription('Get the bot\'s uptime'),
        async execute(interaction) {
            await interaction.reply('Pong!');
        },
    async execute({ client, inter }) {
    let totalSeconds = (client.uptime / 1000);
    let days = Math.floor(totalSeconds / 86400);
    totalSeconds %= 86400;
    let hours = Math.floor(totalSeconds / 3600);
    totalSeconds %= 3600;
    let minutes = Math.floor(totalSeconds / 60);
    let seconds = Math.floor(totalSeconds % 60);
    const embed = new EmbedBuilder()
        .setColor( Math.floor(Math.random() * 16777215).toString(16))
        .setTitle('Bot Uptime')
        .setDescription(`Total Uptime: ${days} days, ${hours} hours, ${minutes} minutes, ${seconds} seconds`)
        .setAuthor({name: (client.user.username).toString(), iconURL: client.user.avatarURL()})
        .setTimestamp();
    
    // send the embed to the channel
    inter.reply({embeds: [embed]});

    },
};

module.exports.info = {
    name: "uptime",
    alias: ["botuptime", "uptimebot"],
    permission: "default",
    category: "general",
    guildOnly: false,
	help: "command to get the bot's uptime"
};