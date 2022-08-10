const { EmbedBuilder } = require('discord.js');
const prefix = process.env.PREFIX

module.exports.execute = (client, message, args) => {
    if (message.author.bot) return;
	if (args.length < 1) {
		const avatarEmbed = new EmbedBuilder()
        .setColor(Math.floor(Math.random() * 16777215).toString(16))
        .setTitle(user.username+ "'s Avatar")
        .setImage(user.displayAvatarURL({size: 1024, dynamic : true}));
	}
	
message.channel.send({ embeds: [exampleEmbed] });
};

module.exports.info = {
    name: "ecchi",
    alias: [],
    permission: "default",
    category: "communication",
    guildOnly: false,
	help: "make the bot embed your message"
};