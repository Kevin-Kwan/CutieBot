/*
    First test command
*/

module.exports = {
  run: async (client, message, args) => {
    message.channel.send('test command')
  }
}

module.exports.info = {
  name: 'test',
  alias: ['test1', 'test2', 'test3'],
  permission: 'default',
  category: 'test',
  guildOnly: false,
  help: 'basic command to see if bot is functioning'
}
