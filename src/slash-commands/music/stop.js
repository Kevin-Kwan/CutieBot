module.exports = {
  name: 'stop',
  description: 'stop the track',
  voiceChannel: true,

  async execute ({ inter }) {
    const queue = player.nodes.get(inter.guildId)
    await inter.deferReply()
    if (!queue || !queue.isPlaying()) {
      return inter.reply({
        content: `No music currently playing ${inter.member}... try again ? ❌`,
        ephemeral: true
      })
    }

    queue.delete()

    inter.reply({
      content: 'Music stopped into this server, see you next time ✅'
    })
  }
}
