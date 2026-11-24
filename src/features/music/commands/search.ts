import {
  ActionRowBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  InteractionContextType,
} from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { MusicError } from '../guards.js';
import { searchResultsEmbed, trackDisplayOf } from '../embeds.js';
import { searchSessions } from '../sessions.js';
import { runMusicCommand, searchTracks } from './shared.js';

const MAX_RESULTS = 10;

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * /search — list the top results and let the invoker pick one from a
 * select menu (component `music:select:<sessionId>`). Replaces the legacy
 * 15-second message collector, which read a channel message and parsed it
 * with parseInt on the Message object (AUDIT §1.5).
 */
export const searchCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('search a track')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option.setName('song').setDescription('the song you want to search').setRequired(true),
    ),
  policy: { guildOnly: true },

  async execute(ctx, interaction) {
    await runMusicCommand(ctx, interaction, 'none', async () => {
      if (interaction.guildId === null)
        throw new MusicError('This command only works in a server.');
      const query = interaction.options.getString('song', true);
      const result = await searchTracks(ctx, interaction, query);
      const tracks = result.tracks.slice(0, MAX_RESULTS);

      searchSessions.put(interaction.id, {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        tracks,
      });

      const menu = new StringSelectMenuBuilder()
        .setCustomId(`music:select:${interaction.id}`)
        .setPlaceholder('Pick a track to play')
        .addOptions(
          tracks.map((track, index) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(truncate(track.title.trim() || 'Untitled', 100))
              .setDescription(truncate(`${track.author} — ${track.duration}`, 100))
              .setValue(String(index)),
          ),
        );
      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);

      await interaction.editReply({
        embeds: [searchResultsEmbed(query, tracks.map(trackDisplayOf))],
        components: [row],
      });
    });
  },
};
