const maxVol = client.config.opt.maxVol;
const { ApplicationCommandOptionType } = require('discord.js');

module.exports = {
  name: 'volume',
  description: 'adjust',
  voiceChannel: true,
  options: [
    {
      name: 'volume',
      description: 'the amount volume',
      type: ApplicationCommandOptionType.Number,
      required: true,
      minValue: 1,
      maxValue: maxVol,
    },
  ],

  async execute({ inter }) {
    const queue = player.nodes.get(inter.guildId);

    if (!queue)
      return inter.followUp({
        content: `No music currently playing ${inter.member}... try again ? ❌`,
        ephemeral: true,
      });
    const vol = inter.options.getNumber('volume');

    if (queue.node.volume === vol)
      return inter.followUp({
        content: `The volume you want to change is already the current one ${inter.member}... try again ? ❌`,
        ephemeral: true,
      });

    const success = queue.node.setVolume(vol);

    return inter.followUp({
      content: success
        ? `The volume has been modified to **${vol}**/**${maxVol}**% 🔊`
        : `Something went wrong ${inter.member}... try again ? ❌`,
    });
  },
};
