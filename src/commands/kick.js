module.exports = {
  run: async (client, message, args) => {
    let reason = args.slice(1).join(" ");
    function getUserFromMention(mention) {
      if (!mention) return;

      if (mention.startsWith("<@") && mention.endsWith(">")) {
        mention = mention.slice(2, -1);

        if (mention.startsWith("!")) {
          mention = mention.slice(1);
        }

        return message.guild.members.cache.get(mention);
      } else {
        return message.guild.members.cache.get(args[0]);
      }
    }

    if (message.author.bot) return;
    if (message.member.permissionsIn(message.channel).has("KICK_MEMBERS")) {
      const user = getUserFromMention(args[0]);
      // todo: implement a way to set a ban duration
      // https://stackoverflow.com/questions/55654965/how-to-add-reason-thing-to-ban-command
      user
        .kick({ reason })
        .then((user) => {
          if (!reason) {
            reason = "No reason provided.";
          }

          const formattedReason = `\`\`${reason}\`\``;
          message.channel.send(
            "" +
              user.displayName +
              " has been successfully kicked for: " +
              formattedReason,
          );
        })
        .catch((error) => {
          console.log(error);
          message.channel.send(
            "You do not have permissions to kick " + args[0] + ".",
          );
        });
    } else {
      message.reply("You do not have permissions to kick people.");
    }
  },
};

module.exports.info = {
  name: "kick",
  alias: ["kick"],
  permission: "default",
  category: "moderation",
  guildOnly: true,
  help: "kick someone in the guild",
};
