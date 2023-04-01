const prefix = process.env.PREFIX;
const { SlashCommandBuilder, PermissionFlagsBits} = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('addemote')
        .setDescription('Add a new emote to the server')
        .addStringOption(option =>
            option
                .setName('url')
                .setDescription('The URL of the image/gif')
                .setRequired(true))
        .addStringOption(option =>
                    option
                        .setName('name')
                        .setDescription('The name of the emote')
                        .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageEmojisAndStickers),
    async execute({ client, inter }) {
        const url = inter.options.getString('url');
        const name = inter.options.getString('name');
        // add emote to the guild
        inter.guild.emojis.create(url, name)
            .then(emoji => inter.reply(`✅ Succesfully Created New Emote: ${emoji.toString()}`))
            .catch(err => inter.reply("Error creating emoji. Check the file's size (no larger than 256.0 KB) or check your command's syntax."));
    },
};