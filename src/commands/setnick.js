module.exports = {
  run: async (client, message, args) => {
    const nick = args.join(' ')
    if (!nick) return message.channel.send('Please provide a nickname')
    message.guild.me.setNickname(nick)
    message.reply(`My nickname has been set to **${nick}**`)
  }
}

module.exports.info = {
  name: 'setnick',
  alias: [''],
  permission: 'admin',
  category: 'general',
  guildOnly: false,
  help: ''
}
