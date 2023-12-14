const { SlashCommandBuilder } = require('discord.js')

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setusername')
    .setDescription("Set a user's username"),
  async execute (interaction) {
    await interaction.reply('Pong!')
  }
}
module.exports.info = {
  name: 'setusername',
  alias: [''],
  permission: 'default',
  category: 'general',
  guildOnly: false,
  help: ''
}
