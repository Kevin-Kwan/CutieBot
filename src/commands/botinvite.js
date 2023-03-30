/*
    Command that returns the bot's invite link
*/

const { Invite } = require("discord.js");

module.exports = {
    run: async (client, message, args) => {
    const prefix = process.env.PREFIX;
    message.reply('https://discord.com/api/oauth2/authorize?client_id=927315876036898866&scope=bot%20applications.commands');
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