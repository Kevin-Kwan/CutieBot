import {
  MessageFlags,
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder,
} from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';

/**
 * The permissions the invite requests — the union of what the features
 * actually use: moderation (Ban/Kick/Moderate Members), messaging
 * (Send/Embed/Attach/Read History for music posts and embeds), and
 * voice (Connect/Speak for playback).
 */
export const INVITE_PERMISSIONS: PermissionsBitField = new PermissionsBitField([
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak,
]);

/** Build the OAuth2 invite URL for a client id. */
export function inviteUrlFor(clientId: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: 'bot applications.commands',
    permissions: INVITE_PERMISSIONS.bitfield.toString(),
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

/**
 * /botinvite — legacy parity, restored in Phase 6 (the old tree had it
 * as both a prefix and a slash command; the Phase 3 port dropped it).
 * Replies ephemerally with the invite link for THIS bot instance.
 */
export const botinviteCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('botinvite')
    .setDescription('Get the invite link for CutieBot'),

  async execute(ctx, interaction) {
    const url = inviteUrlFor(ctx.config.clientId);
    await interaction.reply({
      content: `Invite CutieBot to your server: ${url}`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
