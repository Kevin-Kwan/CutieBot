/*
    Command to test the bot's hosting ping
*/
const { SlashCommandBuilder } = require('discord.js')

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Replies with Pong!'),
  async execute ({ client, inter }) {
    const m = await inter.reply('Ping?')
    inter.editReply(`Pong! ${inter.client.ws.ping} ms`)
  }
}
