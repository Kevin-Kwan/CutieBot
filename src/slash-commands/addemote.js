const prefix = process.env.PREFIX;
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('addemote')
        .setDescription('Add a new emote to the server'),
    async execute(interaction) {
        await interaction.reply('Pong!');
    },
    run: async (client, message, args) => {
    if (message.author.bot) return;
    let guild = message.guild;
    let emoteName = args[1];
    let emoteURL = args[0];
    if (message.author.bot) return;
    if (emoteURL == undefined) {
        message.reply("Usage: `" + prefix + "addemote {URL} {Emote Name}` \nPlease provide a image/gif URL.");
        return;
    } else if (emoteName == undefined) {
        message.reply("Usage: `" + prefix + "addemote {URL} {Emote Name}` \nPlease provide a valid emote name.");
        return;
    } else {
        guild.emojis.create({attachment: emoteURL, name: emoteName})
            .then(emoji => message.reply(`✅ Succesfully Created New Emote: ${emoji.toString()}`))
            .catch(err => message.reply("Error creating emoji. Check the file's size (no larger than 256.0 KB) or check your command's syntax."));
    }
},
};

module.exports.info = {
    name: "addemote",
    alias: ["emoteadd","newemote", "addemoji" , "newemoji"],
    permission: "admin",
    category: "communication",
    guildOnly: true,
	help: "add an emote given a image/gif url"
};