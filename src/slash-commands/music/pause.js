module.exports = {
  name: 'pause',
  description: 'pause the track',
  voiceChannel: true,

  async execute ({ inter }) {
    const queue = player.nodes.get(inter.guildId)
    await inter.deferReply()

    if (!queue) {
      return inter.followUp({
        content: `No music currently playing ${inter.member}... try again ? ❌`,
        ephemeral: true
      })
    }

    if (queue.node.isPaused()) {
      return inter.followUp({
        content: `The track is currently paused, ${inter.member}... try again ? ❌`,
        ephemeral: true
      })
    }

    const success = queue.node.pause(true)

    return inter.followUp({
      content: success
        ? `Current music ${queue.currentTrack.title} paused ✅`
        : `Something went wrong ${inter.member}... try again ? ❌`
    })
  }
}
