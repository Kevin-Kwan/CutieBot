module.exports.execute = (client, message, args) => {
    if (message.author.bot) return;
    message.channel.send('Bot is now resetting...')
    .then((msg) => {
    message.client.destroy();
    console.log("Bot is restarting...");
    message.client.login(process.env.DISCORD_TOKEN);
    msg.edit('Done!')});
    console.log("Bot restarted!");
    
};

module.exports.info = {
    name: "restart",
    alias: [],
    permission: "owner",
    category: "communication",
    guildOnly: false,
	help: "make the bot say something"
};