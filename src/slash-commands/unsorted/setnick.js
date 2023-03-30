const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setnick')
        .setDescription('Set a user\'s nickname'),
        async execute(interaction) {
            await interaction.reply('Pong!');
        },
    }

module.exports.info = {
    name: "setnick",
    alias: [""],
    permission: "default",
    category: "general",
    guildOnly: false,
	help: ""
}