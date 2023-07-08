const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setnick")
    .setDescription("Set the bot's nickname")
    .addStringOption((option) =>
      option
        .setName("nickname")
        .setDescription("The nickname of the bot for this server")
        .setRequired(true),
    ),
  async execute({ client, inter }) {
    const nick = inter.options.getString("nickname");
    if (!nick) return inter.reply("Please provide a nickname");
    inter.guild.me.setNickname(nick);
    inter.reply(`My nickname has been set to **${nick}**`);
  },
};
