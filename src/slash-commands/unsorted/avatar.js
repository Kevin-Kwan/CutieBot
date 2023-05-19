const { EmbedBuilder, SlashCommandBuilder } = require('discord.js')

module.exports = {
  data: new SlashCommandBuilder()
    .setName('avatar')
    .setDescription("Get your avatar or someone else's avatar")
    .addUserOption((option) =>
      option.setName('user').setDescription("The user's avatar you want to see")
    ),
  async execute ({ client, inter }) {
    const user = inter.options.getUser('user') ?? inter.user
    const avatarEmbed = new EmbedBuilder()
      .setColor(Math.floor(Math.random() * 16777215).toString(16))
      .setTitle(user.username + "'s Avatar")
      .setImage(user.displayAvatarURL({ size: 1024, dynamic: true }))
    inter.reply({ embeds: [avatarEmbed] })
  }
}
