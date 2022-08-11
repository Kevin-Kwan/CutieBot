const { EmbedBuilder } = require('discord.js');

module.exports = {
    run: async (client, message, args) => {
    if (message.author.bot) return;
    const user = message.mentions.users.first() || message.author;
    const avatarEmbed = new EmbedBuilder()
        .setColor(Math.floor(Math.random() * 16777215).toString(16))
        .setTitle(user.username+ "'s Avatar")
        .setImage(user.displayAvatarURL({size: 1024, dynamic : true}));
    message.reply({embeds: [ avatarEmbed ]});
    },
};


module.exports.info = {
    name: "avatar",
    alias: ["getavatar","getpfp","getprofilepic","profilepic","pfp"],
    permission: "default",
    category: "general",
    guildOnly: false,
	help: "get your avatar or someone else's avatar"
}