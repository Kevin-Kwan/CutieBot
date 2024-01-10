const { QueueRepeatMode } = require('discord-player');
const { ApplicationCommandOptionType } = require('discord.js');

module.exports = {
  name: 'loop',
  description: "Enable or disable looping of song's or the whole queue",
  voiceChannel: true,
  options: [
    {
      name: 'action',
      description: 'what action you want to preform on the loop',
      type: ApplicationCommandOptionType.String,
      required: true,
      choices: [
        { name: 'Queue', value: 'enable_loop_queue' },
        { name: 'Disable', value: 'disable_loop' },
        { name: 'Song', value: 'enable_loop_song' },
      ],
    },
  ],
  async execute({ inter }) {
    const queue = player.nodes.get(inter.guildId);
    await inter.deferReply();

    if (!queue || !queue.isPlaying())
      return inter.followUp({
        content: `No music currently playing ${inter.member}... try again ? ❌`,
        ephemeral: true,
      });
    switch (inter.options._hoistedOptions.map((x) => x.value).toString()) {
      case 'enable_loop_queue': {
        if (queue.repeatMode === QueueRepeatMode.TRACK)
          return inter.followUp({
            content: `You must first disable the current music in the loop mode (/loop Disable) ${inter.member}... try again ? ❌`,
            ephemeral: true,
          });

        try {
          queue.setRepeatMode(QueueRepeatMode.QUEUE);
        } catch {
          return inter.followUp({
            content: `Something went wrong ${inter.member}... try again ? ❌`,
          });
        }

        return inter.followUp({
          content:
            'Repeat mode **enabled** the whole queue will be repeated endlessly 🔁',
        });
        break;
      }
      case 'disable_loop': {
        if (queue.repeatMode === QueueRepeatMode.OFF)
          return inter.followUp({
            content: `The loop is currently disabled ${inter.member}... try again ? ❌`,
            ephemeral: true,
          });

        try {
          queue.setRepeatMode(QueueRepeatMode.OFF);
        } catch {
          return inter.followUp({
            content: `Something went wrong ${inter.member}... try again ? ❌`,
          });
        }

        return inter.followUp({ content: 'Repeat mode **disabled**' });
        break;
      }
      case 'enable_loop_song': {
        if (queue.repeatMode === QueueRepeatMode.QUEUE)
          return inter.followUp({
            content: `You must first disable the current music in the loop mode (/loop Disable) ${inter.member}... try again ? ❌`,
            ephemeral: true,
          });

        try {
          queue.setRepeatMode(QueueRepeatMode.TRACK);
        } catch {
          return inter.followUp({
            content: `Something went wrong ${inter.member}... try again ? ❌`,
            ephemeral: true,
          });
        }

        return inter.followUp({
          content:
            'Repeat mode **enabled** the current song will be repeated endlessly (you can end the loop with /loop disable)',
        });
        break;
      }
    }
  },
};
