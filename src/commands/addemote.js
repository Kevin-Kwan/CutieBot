module.exports.execute = (client, message, args) => {
    let guild = message.guild;
    let emoteName = args[1];
    let emoteURL = args[0];
    if (message.author.bot) return;
    if (emoteURL==undefined) {
        message.reply("Usage: `<addemote {URL} {Emote Name}` \nPlease provide a image/gif URL.");
        return;
    } else if (emoteName==undefined) {
        message.reply("Usage: `<addemote {URL} {Emote Name}` \nPlease provide a valid emote name.");
        return;
    } else {
    guild.emojis.create(emoteURL, emoteName).catch(DiscordAPIError => message.reply("Usage: `<addemote {URL} {Emote Name}` \nError creating emoji. Check the file's size (no larger than 256.0 KB) or check your command's syntax."));
    // todo: learn about .then and catching stuff because this line below still executes even if there is an error, try catch doesnt work either so idk
    //     .then(message.reply(`Created new emoji with name ${emoteName}!`))
    //.catch(DiscordAPIError => message.reply("Error creating emoji. File cannot be larger than 256.0 kb."));
    }
    // currently, the bot provides no feedback if the emote was created correctly.
    



};

module.exports.info = {
    name: "addemote",
    alias: ["emoteadd","newemote"],
    permission: "default",
    category: "communication",
    guildOnly: true,
	help: "add an emote given a image/gif url"
};