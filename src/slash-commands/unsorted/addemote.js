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
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions),
    async execute({inter}) {
        //await inter.deferReply();
        const emoteURL = inter.options.getString('url');
        const emoteName = inter.options.getString('name');
        if (emoteURL == undefined) {
            inter.reply("Please provide a image/gif URL.");
            return;
        } else if (emoteName == undefined) {
            inter.reply("Please provide a valid emote name.");
            return;
        } else {
            // create emoji using interaction
            inter.guild.emojis.create({attachment: emoteURL, name: emoteName})
                .then(emoji => inter.reply(`✅ Succesfully Created New Emote: ${emoji.toString()}`))
                .catch(err => {
                    if (err.code == 50013) {
                        inter.reply("Error creating emoji. I need the `MANAGE_EMOJIS` permission to do this.");
                    } else if (err.code == 30008) {
                        // catch max emote limit error
                        inter.reply("Error creating emoji. This server has reached the maximum number of emotes.");
                    } else {
                        // catch any other error
                        inter.reply("Error creating emoji. Check the file's size (no larger than 256.0 KB) or check your command's syntax.");
                    }
                });
        }
    },
};