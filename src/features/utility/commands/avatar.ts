import { SlashCommandBuilder } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { economyEmbed } from '../../../shared/embeds.js';

/** /avatar — your avatar, or another user's with the optional user option
 * (same shape as the working legacy command). */
export const avatarCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('avatar')
    .setDescription("Get your avatar or someone else's avatar")
    .addUserOption((option) =>
      option.setName('user').setDescription("The user's avatar you want to see").setRequired(false),
    ),

  async execute(_ctx, interaction) {
    const user = interaction.options.getUser('user', false) ?? interaction.user;
    const embed = economyEmbed(`${user.username}'s Avatar`).setImage(
      user.displayAvatarURL({ size: 1024 }),
    );
    await interaction.reply({ embeds: [embed] });
  },
};
