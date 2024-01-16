// const fetch = require('node-fetch');
const { EmbedBuilder } = require('discord.js');
module.exports = {
  run: async (client, message, args) => {
    if (!args[0]) {
      return message.channel.send('Please provide a Chess.com username.');
    }

    const username = args[0];

    const response = await fetch(
      `https://api.chess.com/pub/player/${username}/stats`
    );
    const data = await response.json();

    if (data.code === 0) {
      return message.channel.send('User not found.');
    }

    const embed = new EmbedBuilder()
      .setTitle(`${username}'s Chess Profile`)
      .addFields(
        {
          name: 'Chess Blitz Rating',
          value: data.chess_blitz.last.rating.toString(),
          inline: true,
        },
        {
          name: 'Chess Rapid Rating',
          value: data.chess_rapid.last.rating.toString(),
          inline: true,
        },
        {
          name: 'Chess Bullet Rating',
          value: data.chess_bullet.last.rating.toString(),
          inline: true,
        }
      )
      .setColor('#0099ff');

    message.channel.send({ embeds: [embed] });
  },
};

module.exports.info = {
  name: 'chessprofile',
  alias: [],
  permission: 'default',
  category: 'misc',
  guildOnly: false,
  help: 'get chess stats',
};
