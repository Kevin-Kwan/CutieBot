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
    message.reply('Use this link to invite the bot to your server: ' + process.env.BOT_INVITE_LINK);
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