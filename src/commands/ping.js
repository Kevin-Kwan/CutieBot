/*
    Command to test the bot's hosting ping
*/

module.exports.execute = (client, message, args) => {
	message.channel.send("Pinging ...")
      .then((msg) => {
        msg.edit(`${client.ws.ping} ms`)
      });
};

module.exports.info = {
    name: "ping",
    alias: ["pung", "pong", "pang"],
    permission: "default",
    type: "general",
    guildOnly: false,
	help: "command to test the bot's ping"
};