module.exports.execute = (client, message, args) => {
    if(args.length < 1){
        message.reply("No avatar URL specified.");
        return;
    }
    client.user.setAvatar(args[0])
        .then(message.reply("Success!"))
        .catch(console.error);
};

module.exports.info = {
    name: "setavatar",
    alias: ["setbotavatar"],
    permission: "owner",
    category: "bot",
    guildOnly: false,
	help: "set the bot's avatar"
};