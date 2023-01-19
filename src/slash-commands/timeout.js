const { SlashCommandBuilder } = require('discord.js');
module.exports = {
    data: new SlashCommandBuilder()
        .setName('timeout')
        .setDescription('Timeout a user from the server'),
        async execute(interaction) {
            await interaction.reply('Pong!');
        },
    }
module.exports.info = {
    name: "timeout",
    alias: [""],
    permission: "default",
    category: "general",
    guildOnly: false,
	help: ""
}