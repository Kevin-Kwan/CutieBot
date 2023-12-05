const prefix = process.env.PREFIX
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js')

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addemote')
    .setDescription('Add a new emote to the server')
    .addStringOption((option) =>
      option
        .setName('url')
        .setDescription('The URL of the image/gif')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('name')
        .setDescription('The name of the emote')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions),
  async execute ({ inter }) {
    // await inter.deferReply();
    const emoteURL = inter.options.getString('url')
    const emoteName = inter.options.getString('name')
    // this checks if emoteURL is a valid url
    const validURL = (str) => {
      const pattern = new RegExp(
        '^(https?:\\/\\/)?' + // protocol
          '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|' + // domain name
          '((\\d{1,3}\\.){3}\\d{1,3}))' + // OR ip (v4) address
          '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*' + // port and path
          '(\\?[;&a-z\\d%_.~+=-]*)?' + // query string
          '(\\#[-a-z\\d_]*)?$',
        'i'
      ) // fragment locator
      return !!pattern.test(str)
    }
    if (!validURL(emoteURL)) {
      inter.reply('Please provide a valid image/gif URL.')
    } else if (emoteURL == undefined) {
      inter.reply('Please provide a image/gif URL.')
    } else if (emoteName == undefined) {
      inter.reply('Please provide a valid emote name.')
    } else {
      // create emoji using interaction
      inter.guild.emojis
        .create({ attachment: emoteURL, name: emoteName })
        .then((emoji) =>
          inter.reply(`✅ Succesfully Created New Emote: ${emoji.toString()}`)
        )
        .catch((err) => {
          if (err.code == 50013) {
            inter.reply(
              'Error creating emoji. I need the `MANAGE_EMOJIS` permission to do this.'
            )
          } else if (err.code == 30008) {
            // catch max emote limit error
            inter.reply(
              'Error creating emoji. This server has reached the maximum number of emotes.'
            )
          } else {
            // catch any other error
            inter.reply(
              "Error creating emoji. Check the file's size (no larger than 256.0 KB) or check your command's syntax."
            )
          }
        })
    }
  }
}
