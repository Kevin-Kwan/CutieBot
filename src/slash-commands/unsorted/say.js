const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('say')
        .setDescription('Make the bot say something'),
        async execute(interaction) {
            await interaction.reply('Pong!');
        },
    run: async (client, message, args) => {
    if (message.author.bot) return;
    const saidMessage = args.join(" ");
	message.channel.send(saidMessage);
    },
};

module.exports.info = {
    name: "say",
    alias: [],
    permission: "default",
    category: "communication",
    guildOnly: false,
	help: "make the bot say something"
};