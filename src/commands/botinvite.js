/*
    Command that returns the bot's invite link
*/

const { Invite } = require("discord.js");

module.exports.execute = (client, message, args) => {
    const prefix = process.env.PREFIX;
    message.reply('https://discord.com/oauth2/authorize?client_id=927315876036898866&permissions=8&scope=bot');
};

module.exports.info = {
    name: "botinvite",
    alias: ["invite"],
    permission: "default",
    type: "general",
    guildOnly: false,
	help: "command to get the bot's invite"
};