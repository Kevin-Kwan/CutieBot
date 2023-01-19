/*
    Command to test the bot's hosting ping
*/

module.exports = {
  run: async (client, message, args) => {
	message.channel.send("Pinging ...")
      .then((msg) => {
        msg.edit(`${client.ws.ping} ms`)
      });
    },
};


module.exports.info = {
    name: "ping",
    alias: ["pung", "pong", "pang"],
    permission: "default",
    category: "general",
    guildOnly: false,
	help: "command to test the bot's ping"
};