const { SlashCommandBuilder } = require('discord.js')

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mcserver')
    .setDescription('Get the status of a Minecraft server'),
  async execute (interaction) {
    await interaction.reply('Pong!')
  }
}

module.exports.info = {
  name: 'mcserver',
  alias: [''],
  permission: 'default',
  category: 'general',
  guildOnly: false,
  help: ''
}
