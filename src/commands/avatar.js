const { MessageEmbed } = require('discord.js');

module.exports.execute = (client, message, args) => {
    if (message.author.bot) return;
    const user = message.mentions.users.first() || message.author;
    const avatarEmbed = new MessageEmbed()
        .setColor('RANDOM')
        .setAuthor(user.username+ "'s Avatar")
        .setImage(user.displayAvatarURL({size: 1024, dynamic : true}));
    message.channel.send({embeds: [avatarEmbed ]});

};


module.exports.info = {
    name: "avatar",
    alias: ["getavatar","getpfp","getprofilepic","profilepic","pfp"],
    permission: "default",
    category: "general",
    guildOnly: false,
	help: "get your avatar or someone else's avatar"
}