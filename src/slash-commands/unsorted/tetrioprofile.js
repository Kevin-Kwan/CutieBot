const { SlashCommandBuilder } = require('discord.js');
module.exports = {
    data: new SlashCommandBuilder()
        .setName('tetrioprofile')
        .setDescription('Get a user\'s tetrio profile'),
        async execute(interaction) {
            await interaction.reply('Pong!');
        }
}
module.exports.info = {
    name: "tetrioprofile",
    alias: [""],
    permission: "default",
    category: "general",
    guildOnly: false,
	help: ""
}