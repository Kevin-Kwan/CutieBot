/*
    Command that returns the bot's invite link
*/

const { Invite, SlashCommandBuilder } = require('discord.js')

module.exports = {
  data: new SlashCommandBuilder()
    .setName('botinvite')
    .setDescription("Get the bot's invite link"),
  async execute ({ client, inter }) {
    inter.reply(
      'Use this link to invite the bot to your server: ' +
        process.env.BOT_INVITE_LINK
    )
  }
}
