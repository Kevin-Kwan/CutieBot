const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    
    data: new SlashCommandBuilder()
		.setName('restart')
		.setDescription('Restarts the bot')
        .setDefaultMemberPermissions(PermissionFlagsBits.ADMINISTRATOR),
    async execute({ client, inter }) {
        if (inter.user.id != process.env.OWNER) {
            return inter.reply("You are not the owner of this bot!")
        } else {
            client.destroy();
            inter.reply("Restarting...")
            client.login(process.env.DISCORD_TOKEN);
            inter.editReply("Done!");
        }
    }
};