/*
    Command that returns the bot's prefix
*/

module.exports = {
  run: async (client, message, args) => {
    const prefix = process.env.PREFIX
    message.channel.send(`Bot's Prefix: \`\`${prefix}\`\``)
  }
}

module.exports.info = {
  name: 'prefix',
  alias: [],
  permission: 'default',
  category: 'general',
  guildOnly: false,
  help: "command to get the bot's prefix"
}
