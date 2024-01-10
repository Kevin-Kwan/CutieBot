module.exports = {
  name: 'shuffle',
  description: 'shuffle the track',
  voiceChannel: true,

  async execute ({ inter }) {
    const queue = player.nodes.get(inter.guildId)
    await inter.deferReply()
    if (!queue || !queue.isPlaying()) {
      return inter.followUp({
        content: `No music currently playing ${inter.member}... try again ? ❌`,
        ephemeral: true
      })
    }

    if (!queue.tracks.toArray()[0]) {
      return inter.followUp({
        content: `No music in the queue after the current one ${inter.member}... try again ? ❌`,
        ephemeral: true
      })
    }

    await queue.tracks.shuffle()

    return inter.followUp({
      content: `Queue shuffled **${queue.tracks.size}** song(s) ! ✅`
    })
  }
}
