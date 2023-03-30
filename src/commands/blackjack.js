const { EmbedBuilder } = require('discord.js');
const prefix = process.env.PREFIX

module.exports = {
    run: async (client, message, args) => {
    // args is the amount you want to bet
    // if args is undefined, then args = 0
    if (message.author.bot) return;
    },
};

module.exports.info = {
    name: "blackjack",
    alias: ["bj"],
    permission: "default",
    category: "communication",
    guildOnly: false,
	help: "make the bot say something"
};