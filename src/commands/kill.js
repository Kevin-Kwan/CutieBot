module.exports = {
  run: async (client, message, args) => {
    if (message.author.bot) return
    message.channel.send('Shutting down the bot...')
    process.exit()
  }
}

module.exports.info = {
  name: 'kill',
  alias: ['', '', ''],
  permission: 'owner',
  category: 'danger',
  guildOnly: false,
  help: 'shut down the bot'
}
