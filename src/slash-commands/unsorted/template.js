const { EmbedBuilder, SlashCommandBuilder } = require('discord.js')
const prefix = process.env.PREFIX

module.exports = {
  data: new SlashCommandBuilder()
    .setName('template')
    .setDescription('Template for commands'),
  async execute (interaction) {
    await interaction.reply('Pong!')
  },
  run: async (client, message, args) => {
    if (message.author.bot) return
  }
}

module.exports.info = {
  name: 'say',
  alias: ['', '', ''],
  permission: 'default',
  category: 'communication',
  guildOnly: false,
  help: 'make the bot say something'
}
