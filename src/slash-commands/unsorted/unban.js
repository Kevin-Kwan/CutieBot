const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
		.setName('unban')
		.setDescription('Unban someone.')
		.addUserOption(option =>
			option
				.setName('target')
				.setDescription('The member to ban (ID preferred).')
				.setRequired(true))
		.setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
		.setDMPermission(false),
    async execute({ client, inter }) {
        const target = inter.options.getUser('target');
		// attempt to unban the target member, catch error if no permissions or cannot somehow unban the member
		await inter.guild.members.unban(target)
		.then(() => {
			// if the target member is successfully banned, send a success message
			inter.reply(`Unbanned ${target.username} successfully.`);
		})
		.catch(err => {
			// if the error is that the bot cannot ban the target member, send an error message
			if (err.code == 50013) {
				inter.reply("Error unbanning member. I am missing permissions to do this.");
			} else {
				inter.reply("Error unbanning member. Please try again later.");
			}
		});
    }
};