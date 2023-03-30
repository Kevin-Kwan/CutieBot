const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setavatar')
        .setDescription('Set the bot\'s avatar'),
        async execute(interaction) {
            await interaction.reply('Pong!');
        },
    run: async (client, message, args) => {
    if(args.length < 1){
        message.reply("No avatar URL specified.");
        return;
    }
    client.user.setAvatar(args[0])
        .then(message.reply("Success!"))
        .catch(console.error);
},
};

module.exports.info = {
    name: "setavatar",
    alias: ["setbotavatar"],
    permission: "owner",
    category: "bot",
    guildOnly: false,
	help: "set the bot's avatar"
};