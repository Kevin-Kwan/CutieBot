module.exports = {
  name: 'resume',
  description: 'Play the track',
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

    if (queue.node.isPlaying()) {
      return inter.followUp({
        content: `The track is already running, ${inter.member}... try again ? ❌`,
        ephemeral: true
      })
    }

    const success = queue.node.resume()

    return inter.followUp({
      content: success
        ? `Current music ${queue.currentTrack.title} resumed ✅`
        : `Something went wrong ${inter.member}... try again ? ❌`
    })
  }
}
