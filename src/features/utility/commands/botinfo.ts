import { SlashCommandBuilder } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { economyEmbed } from '../../../shared/embeds.js';
import { formatUptime } from '../../../shared/time.js';

/**
 * /botinfo — the accurate subset of the legacy botinfo (both copies were
 * ~95% identical): name, uptime, memory, ping, guild/user counts. Dropped
 * on purpose: the nonsense CPU formula `(loadavgTime()/2)*10` (AUDIT §5.34),
 * the hardcoded version '0.0.1', the prefix (slash-only now), and the owner
 * author block (the owner user may not be cached — the legacy code threw
 * on `.tag` when it wasn't).
 */
export const botinfoCommand: CommandModule = {
  data: new SlashCommandBuilder().setName('botinfo').setDescription("Get the bot's information"),

  async execute(ctx, interaction) {
    const client = ctx.client;
    const botUser = client.user;
    const heapMb = process.memoryUsage().heapUsed / 1024 / 1024;

    const embed = economyEmbed('Bot Information').addFields(
      { name: 'Bot Name', value: botUser?.tag ?? 'CutieBot', inline: true },
      { name: 'Uptime', value: formatUptime(client.uptime ?? 0), inline: true },
      { name: 'Memory Usage', value: `${heapMb.toFixed(1)} MB`, inline: true },
      { name: 'Gateway Ping', value: `${Math.round(client.ws.ping)} ms`, inline: true },
      { name: 'Guilds', value: String(client.guilds.cache.size), inline: true },
      { name: 'Cached Users', value: String(client.users.cache.size), inline: true },
    );
    if (botUser !== null) {
      embed.setThumbnail(botUser.displayAvatarURL());
    }
    embed.setTimestamp();
    await interaction.reply({ embeds: [embed] });
  },
};
