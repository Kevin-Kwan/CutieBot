module.exports = {
  run: async (client, message, args) => {
    if (message.author.bot) return
    const saidMessage = args.join(' ')
    message.channel.send(saidMessage)
  }
}

module.exports.info = {
  name: 'say',
  alias: [],
  permission: 'default',
  category: 'communication',
  guildOnly: false,
  help: 'make the bot say something'
}
