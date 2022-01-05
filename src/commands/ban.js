

module.exports.execute = (client, message, args) => {
    let reason = args.slice(1).join(" ");
    function getUserFromMention(mention) {
        if (!mention) return;
    
        if (mention.startsWith('<@') && mention.endsWith('>')) {
            mention = mention.slice(2, -1);
    
            if (mention.startsWith('!')) {
                mention = mention.slice(1);
            }
    
            return message.guild.members.cache.get(mention);
        }
        else
        {
            return message.guild.members.cache.get(args[0]);
        }
    }

    if (message.author.bot) return;
    if (message.member.permissionsIn(message.channel).has("BAN_MEMBERS")) {
        const user = getUserFromMention(args[0]);
        if (user) {
            try {
                user.ban();
            } catch {
                message.reply("I do not have permissions to ban " + args[0]);
                // this doesn't work for some reason, please someone debug
            }
        } else if (!user) {
            message.reply("You must mention someone to ban!");
        } else {
            message.reply("You do not have permissions to ban " + args[0]);
        }
    }
    else
    {
        message.reply("You do not have permissions to ban people.");
    }
}

module.exports.info = {
    name: "ban",
    alias: ["permaban"],
    permission: "default",
    category: "moderation",
    guildOnly: true,
	help: "ban someone in the guild"
};