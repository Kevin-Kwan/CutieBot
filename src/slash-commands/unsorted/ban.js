const { SlashCommandBuilder, PermissionFlagsBits} = require('discord.js');
module.exports = {
	data: new SlashCommandBuilder()
		.setName('ban')
		.setDescription('Select a member and ban them.')
		.addUserOption(option =>
			option
				.setName('target')
				.setDescription('The member to ban')
				.setRequired(true))
		.addStringOption(option =>
			option
				.setName('reason')
				.setDescription('The reason for banning'))
		.setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
		.setDMPermission(false),
    async execute({ client, inter }) {
        const target = inter.options.getUser('target');
        const reason = inter.options.getString('reason') ?? 'No reason provided';
        await inter.reply(`Banning ${target.username} for reason: ${reason}`);
		await inter.guild.members.ban(target);
    }
};