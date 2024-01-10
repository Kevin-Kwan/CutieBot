const { ApplicationCommandOptionType } = require('discord.js');

module.exports = {
  name: 'filter',
  description: 'add a filter to your track',
  voiceChannel: true,
  options: [
    {
      name: 'filter',
      description: 'filter you want to add',
      type: ApplicationCommandOptionType.String,
      required: true,
      choices: [
        ...Object.keys(require('discord-player').AudioFilters.filters)
          .map((m) => Object({ name: m, value: m }))
          .splice(0, 25),
      ],
    },
  ],

  async execute({ inter, client }) {
    const queue = player.nodes.get(inter.guildId);
    await inter.deferReply();
    if (!queue || !queue.isPlaying())
      return inter.followUp({
        content: `No music currently playing ${inter.member}... try again ? ❌`,
        ephemeral: true,
      });

    const actualFilter = queue.filters.ffmpeg.getFiltersEnabled()[0];

    const infilter = inter.options.getString('filter');

    const filters = [];

    queue.filters.ffmpeg.getFiltersEnabled().map((x) => filters.push(x));
    queue.filters.ffmpeg.getFiltersDisabled().map((x) => filters.push(x));

    const filter = filters.find(
      (x) => x.toLowerCase() === infilter.toLowerCase()
    );

    if (!filter)
      return inter.followUp({
        content: `This filter doesn't exist ${
          inter.member
        }... try again ? ❌\n${
          actualFilter ? `Filter currently active : ${actualFilter}.\n` : ''
        }List of available filters : ${filters
          .map((x) => `**${x}**`)
          .join(', ')}.`,
        ephemeral: true,
      });

    queue.filters.ffmpeg.toggle(filter.toString());

    inter.followUp({
      content: `The filter ${filter} is now **${
        queue.filters.ffmpeg.isEnabled(filter) ? 'enabled' : 'disabled'
      }** ✅\n*Reminder the longer the music is, the longer this will take.*`,
    });
  },
};
