const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js')
module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Select a member and ban them.')
    .addUserOption((option) =>
      option
        .setName('target')
        .setDescription('The member to ban.')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('The reason for banning this user.')
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false),
  async execute ({ client, inter }) {
    const target = inter.options.getUser('target')
    const reason = inter.options.getString('reason') ?? 'No reason provided'
    // attempt to ban the target member, catch error if no permissions or cannot somehow ban the member
    await inter.guild.members
      .ban(target, { reason })
      .then(() => {
        // if the target member is successfully banned, send a success message
        inter.reply(`Banned ${target.username} for reason: ${reason}`)
      })
      .catch((err) => {
        // if the error is that the bot cannot ban the target member, send an error message
        if (err.code == 50013) {
          inter.reply(
            'Error banning member. I am missing permissions to do this.'
          )
        } else {
          inter.reply('Error banning member. Please try again later.')
        }
      })
  }
}
