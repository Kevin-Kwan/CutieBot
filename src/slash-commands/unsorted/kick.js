const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kick a user from the server'),
        async execute(interaction) {
            await interaction.reply('Pong!');
        },
    }

module.exports.info = {
    name: "kick",
    alias: [""],
    permission: "default",
    category: "general",
    guildOnly: true,
	help: ""
}