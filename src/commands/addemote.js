// abandon this command once ALL slash commands are implemented
const prefix = process.env.PREFIX
module.exports = {
  run: async (client, message, args) => {
    if (message.author.bot) return
    const guild = message.guild
    const emoteName = args[1]
    const emoteURL = args[0]
    if (message.author.bot) return
    if (emoteURL == undefined) {
      message.reply(
        'Usage: `' +
          prefix +
          'addemote {URL} {Emote Name}` \nPlease provide a image/gif URL.'
      )
    } else if (emoteName == undefined) {
      message.reply(
        'Usage: `' +
          prefix +
          'addemote {URL} {Emote Name}` \nPlease provide a valid emote name.'
      )
    } else {
      guild.emojis
        .create({ attachment: emoteURL, name: emoteName })
        .then((emoji) =>
          message.reply(`✅ Succesfully Created New Emote: ${emoji.toString()}`)
        )
        // catch different types of possible errors
        // catch no permissions error
        .catch((err) => {
          if (err.code == 50013) {
            message.reply(
              'Error creating emoji. I need the `MANAGE_EMOJIS` permission to do this.'
            )
          } else if (err.code == 30008) {
            // catch max emote limit error
            message.reply(
              'Error creating emoji. This server has reached the maximum number of emotes.'
            )
          } else {
            // catch any other error
            message.reply(
              "Error creating emoji. Check the file's size (no larger than 256.0 KB) or check your command's syntax."
            )
          }
        })
    }
  }
}

module.exports.info = {
  name: 'addemote',
  alias: ['emoteadd', 'newemote', 'addemoji', 'newemoji'],
  permission: 'admin',
  category: 'communication',
  guildOnly: true,
  help: 'add an emote given a image/gif url'
}
