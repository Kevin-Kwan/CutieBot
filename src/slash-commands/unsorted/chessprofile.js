const { SlashCommandBuilder } = require('discord.js')

module.exports = {
  data: new SlashCommandBuilder()
    .setName('chessprofile')
    .setDescription("Get a user's chess.com profile"),
  async execute (interaction) {
    await interaction.reply('Pong!')
  }
}

module.exports.info = {
  name: 'chessprofile',
  alias: [''],
  permission: 'default',
  category: 'general',
  guildOnly: false,
  help: ''
}
