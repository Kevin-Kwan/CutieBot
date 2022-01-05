module.exports.execute = (client, message, args) => {
    if (message.author.bot) return;
    const target = message.mentions.members.first() || message.guild.users.cache.get(args[0]);
};


module.exports.info = {
    name: "avatar",
    alias: [""],
    permission: "default",
    category: "general",
    guildOnly: false,
	help: ""
}