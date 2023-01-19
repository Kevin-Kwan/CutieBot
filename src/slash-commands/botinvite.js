/*
    Command that returns the bot's invite link
*/

const { Invite, SlashCommandBuilder } = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('botinvite')
        .setDescription('Get the bot\'s invite link'),
    async execute(interaction) {
        await interaction.reply('Pong!');
    },
    run: async (client, message, args) => {
    const prefix = process.env.PREFIX;
    message.reply('https://discord.com/api/oauth2/authorize?client_id=927315876036898866&permissions=8&scope=bot%20applications.commands');
    },
};

module.exports.info = {
    name: "botinvite",
    alias: ["invite"],
    permission: "default",
    category: "general",
    guildOnly: false,
	help: "command to get the bot's invite"
};