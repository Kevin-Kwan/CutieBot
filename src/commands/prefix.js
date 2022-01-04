/*
    First test command
*/

module.exports.execute = (client, message, args) => {
    message.channel.send("Bot's Prefix: " + prefix);
};

module.exports.info = {
    name: "prefix",
    alias: [],
    permission: "default",
    type: "general",
    guildOnly: false,
	help: "command to get the bot's prefix"
};