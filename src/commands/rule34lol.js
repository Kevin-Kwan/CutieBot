const { EmbedBuilder } = require('discord.js')
const prefix = process.env.PREFIX
const subreddits = ['rule34lol']
const trev = require('trev')
const delay = 3000
let sub = subreddits[Math.round(Math.random() * (subreddits.length - 1))]

module.exports = {
  run: async (client, message, args) => {
    if (message.author.bot) return
    getImage(message, sub).catch((e) => getImage(message, sub))
    setTimeout(() => message.delete(), delay)
  }
}

async function getImage (givenMessage, subredditName) {
  sub = subreddits[Math.round(Math.random() * (subreddits.length - 1))]
  const subr = await trev.getCustomSubreddit(sub)
  if (!subr) {
    const replyEmbed = new EmbedBuilder()
      .setColor(Math.floor(Math.random() * 16777215).toString(16))
      .setTitle('Error Retrieving Image!')
      .setDescription(
        'This subreddit, ``' +
          sub +
          '``, is broken and media cannot be retrieved! Please try another subreddit!'
      )
    givenMessage.reply({ embeds: [replyEmbed] })
    return
  }
  // check if media is undefined
  if (!subr.media) {
    const replyEmbed = new EmbedBuilder()
      .setColor(Math.floor(Math.random() * 16777215).toString(16))
      .setTitle('Error Retrieving Image!')
      .setDescription(
        'Failed to retrieve media from subreddit: ``' + sub + '``!'
      )
    givenMessage.reply({ embeds: [replyEmbed] })
    return
  }
  const image = subr.media
  // console.log(image);
  if (
    image.toString().includes('.png') ||
    image.toString().includes('.jpg') ||
    image.toString().includes('.jpeg') ||
    image.toString().includes('.gif')
  ) {
    const imageEmbed = new EmbedBuilder()
      .setColor(Math.floor(Math.random() * 16777215).toString(16))
      .setTitle('Random Image from r/' + sub)
      .setURL(image)
      .setImage(image)
    givenMessage.reply({ embeds: [imageEmbed] })
  } else {
    getImage(givenMessage, sub)
  }
  // givenMessage.delete({timeout: delay}).catch(console.error);
}

module.exports.info = {
  name: 'rule34lol',
  alias: ['rule34lol'],
  permission: 'default',
  category: 'NSFW',
  guildOnly: false,
  help: 'make the bot post lewd images from this subreddit ;)'
}
