/*
    First test command
*/

module.exports.execute = (client, message, args) => {
    console.log("test");
    message.channel.send("test command");
};

module.exports.info = {
    name: "pogchamp",
    alias: ["test1", "test2", "test3"],
    permission: "default",
    type: "test",
    guildOnly: false,
	help: "basic command to see if bot is functioning"
};