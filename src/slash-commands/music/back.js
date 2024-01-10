module.exports = {
  name: 'back',
  description: 'Go back the song before',
  voiceChannel: true,

  async execute ({ inter }) {
    const queue = player.nodes.get(inter.guildId)
    await inter.deferReply()

    if (!queue || !queue.node.isPlaying()) {
      return inter.followUp({
        content: `No music currently playing ${inter.member}... try again ? ❌`,
        ephemeral: true
      })
    }

    if (!queue.history.previousTrack) {
      return inter.followUp({
        content: `There was no music played before ${inter.member}... try again ? ❌`,
        ephemeral: true
      })
    }

    await queue.history.back()

    inter.followUp({ content: 'Playing the **previous** track ✅' })
  }
}
