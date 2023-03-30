/*
    Command to test the bot's hosting ping
*/
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('ping')
		.setDescription('Replies with Pong!'),
  execute: async (interaction) => {
    await interaction.reply(`Pong! ${interaction.client.ws.ping} ms`);
  },
  run: async (client, message, args) => {
    	message.channel.send("Pinging ...")
          .then((msg) => {
            msg.edit(`${client.ws.ping} ms`)
          });
        },
};

// module.exports = {
//   run: async (client, message, args) => {
// 	message.channel.send("Pinging ...")
//       .then((msg) => {
//         msg.edit(`${client.ws.ping} ms`)
//       });
//     },
// };


module.exports.info = {
    name: "ping",
    alias: ["pung", "pong", "pang"],
    permission: "default",
    category: "general",
    guildOnly: false,
	help: "command to test the bot's ping"
};