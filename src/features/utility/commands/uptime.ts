import { SlashCommandBuilder } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { economyEmbed } from '../../../shared/embeds.js';
import { formatUptime } from '../../../shared/time.js';

/**
 * /uptime — how long the bot has been connected. The legacy slash version
 * declared `execute` twice in one object (AUDIT §5) and the math was
 * duplicated across three files; the formatting lives in shared/time.ts now.
 */
export const uptimeCommand: CommandModule = {
  data: new SlashCommandBuilder().setName('uptime').setDescription("Get the bot's uptime"),

  async execute(ctx, interaction) {
    const uptimeMs = ctx.client.uptime ?? 0;
    const embed = economyEmbed('Bot Uptime', `Total Uptime: ${formatUptime(uptimeMs)}`);
    const botUser = ctx.client.user;
    if (botUser !== null) {
      embed.setAuthor({ name: botUser.username, iconURL: botUser.displayAvatarURL() });
    }
    embed.setTimestamp();
    await interaction.reply({ embeds: [embed] });
  },
};
