import { MessageFlags, SlashCommandBuilder, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { errorEmbed, successEmbed } from '../../../shared/embeds.js';

/**
 * True when the value parses as a plain https URL with no embedded
 * credentials (Phase 6, P2-14 — an avatar URL is fetched by Discord,
 * but the bot should not hand it arbitrary intranet/credential shapes).
 */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

/**
 * /setavatar — owner-only. The legacy version replied "Success!" before the
 * setAvatar promise settled (AUDIT inventory); v3 awaits it and only then
 * confirms. Discord still validates the image itself server-side.
 *
 * Phase 6 (P2-10/P2-14): the PREFERRED input is an uploaded attachment
 * (Discord-hosted, content-typed, size-bounded by the platform) — the
 * free-text URL stays as a fallback but must be credential-free https.
 * The interaction defers BEFORE the slow setAvatar call instead of
 * awaiting it un-acked.
 */
export const setavatarCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('setavatar')
    .setDescription("Set the bot's avatar from an uploaded image or URL (owner only)")
    .setContexts(InteractionContextType.Guild)
    .addAttachmentOption((option) =>
      option.setName('image').setDescription('The new avatar image (upload)').setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName('url')
        .setDescription('https URL of the new avatar image (fallback)')
        .setRequired(false),
    ),
  policy: { ownerOnly: true },

  async execute(ctx, interaction) {
    const attachment = interaction.options.getAttachment('image');
    const urlOption = interaction.options.getString('url')?.trim();

    let url: string;
    if (attachment !== null) {
      if (!isHttpUrl(attachment.url)) {
        await interaction.reply({
          embeds: [errorEmbed('That attachment does not look usable as an avatar.')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      url = attachment.url;
    } else if (urlOption !== undefined && urlOption !== '') {
      if (!isHttpUrl(urlOption) || !urlOption.startsWith('https://')) {
        await interaction.reply({
          embeds: [errorEmbed('Please provide a valid https image URL (no credentials).')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      url = urlOption;
    } else {
      await interaction.reply({
        embeds: [errorEmbed('Upload an image or provide an https URL for the new avatar.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const botUser = ctx.client.user;
    if (botUser === null) {
      await interaction.reply({
        embeds: [errorEmbed('The bot is not logged in yet.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await botUser.setAvatar(url);
    ctx.logger.info({ action: 'setavatar', actorId: interaction.user.id }, 'Bot avatar changed');
    await interaction.editReply({
      embeds: [successEmbed('Avatar Updated', 'The bot avatar has been changed.')],
    });
  },
};
