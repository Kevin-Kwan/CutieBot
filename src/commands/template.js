const { EmbedBuilder } = require('discord.js')
const prefix = process.env.PREFIX

module.exports = {
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
