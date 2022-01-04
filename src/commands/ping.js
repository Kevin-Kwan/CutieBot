/*
    Command to test the bot's hosting ping
*/

module.exports.execute = (client, message, args) => {
	console.log("Ping test");
	message.channel.send("Pinging ...")
      .then((msg) => {
        msg.edit(`${client.ws.ping} ms`)
      });
};

module.exports.info = {
    name: "ping",
    alias: ["pung", "pong", "pang"],
    permission: "default",
    type: "test",
    guildOnly: false,
	help: "command to test the bot's ping"
};