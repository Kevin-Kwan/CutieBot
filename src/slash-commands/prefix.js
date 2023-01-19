/*
    Command that returns the bot's prefix
*/
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('prefix')
        .setDescription('Get the bot\'s prefix'),
        async execute(interaction) {
            await interaction.reply('Pong!');
        },
    run: async (client, message, args) => {
    const prefix = process.env.PREFIX;
    message.channel.send(`Bot's Prefix: \`\`${prefix}\`\``);
    },
};

module.exports.info = {
    name: "prefix",
    alias: [],
    permission: "default",
    category: "general",
    guildOnly: false,
	help: "command to get the bot's prefix"
};