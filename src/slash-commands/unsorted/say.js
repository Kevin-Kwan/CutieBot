const { SlashCommandBuilder } = require('discord.js')

module.exports = {
  data: new SlashCommandBuilder()
    .setName('say')
    .setDescription('Make the bot say something')
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription('The message to say.')
        .setRequired(true)
    ),
  async execute ({ client, inter }) {
    const saidMessage = inter.options.getString('message')
    // the next two lines make it seem like the bot just talked with no trace of you ever using the command
    inter.deferReply()
    inter.deleteReply()
    inter.channel.send(saidMessage)
  }
}
