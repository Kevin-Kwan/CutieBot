module.exports = {
  name: 'skip',
  description: 'stop the track',
  voiceChannel: true,

  async execute({ inter }) {
    const queue = player.nodes.get(inter.guildId);
    await inter.deferReply();

    if (!queue || !queue.isPlaying())
      return inter.followUp({
        content: `No music currently playing ${inter.member}... try again ? ❌`,
        ephemeral: true,
      });

    const success = queue.node.skip();

    return inter.followUp({
      content: success
        ? `Current music ${queue.currentTrack.title} skipped ✅`
        : `Something went wrong ${inter.member}... try again ? ❌`,
    });
  },
};
