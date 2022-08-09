module.exports.execute = (client, message, args) => {
    let guild = message.guild;
    let emoteName = args[1];
    let emoteURL = args[0];
    if (message.author.bot) return;
    if (emoteURL == undefined) {
        message.reply('Usage: `<addemote {URL} {Emote Name}` \nPlease provide a image/gif URL.');
        return;
    } else if (emoteName == undefined) {
        message.reply('Usage: `<addemote {URL} {Emote Name}` \nPlease provide a valid emote name.');
        return;
    } else {
        guild.emojis.create(emoteURL, emoteName)
        .then(emoji => message.reply(`✅ Succesfully Created New Emote: ${emoji.toString()}`)).catch(err => message.reply("Error creating emoji. Check the file's size (no larger than 256.0 KB) or check your command's syntax."));
    }
};

module.exports.info = {
    name: "addemote",
    alias: ["emoteadd","newemote", "addemoji" , "newemoji"],
    permission: "default",
    category: "communication",
    guildOnly: true,
	help: "add an emote given a image/gif url"
};