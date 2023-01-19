const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const prefix = process.env.PREFIX

module.exports = {
	data: new SlashCommandBuilder()
		.setName('embed')
		.setDescription('Create an embed'),
	async execute(interaction) {
		await interaction.reply('Pong!');
	},
    run: async (client, message, args) => {
    if (message.author.bot) return;
	if (args.length < 1) {
		message.reply("Usage: `" + prefix + "embed {message}` \nYou need to specify a message for the bot to embed!");
		return;
	}
    const exampleEmbed = new EmbedBuilder()
	.setColor(Math.floor(Math.random() * 16777215).toString(16))
	//.setTitle(args.shift())
	//.setURL('https://discord.js.org/')
	.setAuthor({ name: message.author.username, iconURL: message.author.avatarURL()})
	.setDescription(args.join(" "))
	//.setThumbnail('https://i.imgur.com/AfFp7pu.png')
	// .addFields(
	// 	{ name: 'Regular field title', value: 'Some value here' },
	// 	{ name: '\u200B', value: '\u200B' },
	// 	{ name: 'Inline field title', value: 'Some value here', inline: true },
	// 	{ name: 'Inline field title', value: 'Some value here', inline: true },
	// )
	// .addField('Inline field title', 'Some value here', true)
	// .setImage('https://i.imgur.com/AfFp7pu.png')
	// .setTimestamp()
	// .setFooter('Some footer text here', 'https://i.imgur.com/AfFp7pu.png');

    //tested, does create an embed message
    //todo: include prompts so titles can be longer than 1 word, so seperate the title and description handling, and then delete prompts
    //clean up how the embed looks as well lmao
    //currently, we do not plan to allow users to add fields

    // but yea creating an embed does work
message.channel.send({ embeds: [exampleEmbed] });
	},
};

module.exports.info = {
    name: "embed",
    alias: ["sayembed","createembed","makeembed"],
    permission: "default",
    category: "communication",
    guildOnly: false,
	help: "make the bot embed your message"
};