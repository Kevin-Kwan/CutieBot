const { EmbedBuilder, InteractionType } = require('discord.js');
const { SlashCommand, time_convertor } = require('../base');

module.exports = async(client, inter) => {
    if (inter.type === InteractionType.ApplicationCommand) {
        const DJ = client.config.opt.DJ;
        const command = client.slashcommands.get(inter.commandName);
        const command_name = inter.commandName;
        const user = inter.user;

    if (!command) return inter.reply({ embeds: [ new EmbedBuilder().setColor('#ff0000').setDescription('❌ | Error! Please contact Developers!')], ephemeral: true, }), client.slash.delete(inter.commandName)
    if (command.permissions && !inter.member.permissions.has(command.permissions)) return inter.reply({ embeds: [ new EmbedBuilder().setColor('#ff0000').setDescription(`❌ | You need do not have the proper permissions to exacute this command`)], ephemeral: true, })
    if (DJ.enabled && DJ.commands.includes(command) && !inter.member._roles.includes(inter.guild.roles.cache.find(x => x.name === DJ.roleName).id)) return inter.reply({ embeds: [ new EmbedBuilder().setColor('#ff0000').setDescription(`❌ | This command is reserved For members with \`${DJ.roleName}\` `)], ephemeral: true, })
    if (command.voiceChannel) {
            if (!inter.member.voice.channel) return inter.reply({ embeds: [ new EmbedBuilder().setColor('#ff0000').setDescription(`❌ | You are not in a Voice Channel`)], ephemeral: true, })
            if (inter.guild.members.me.voice.channel && inter.member.voice.channel.id !== inter.guild.members.me.voice.channel.id) return inter.reply({ embeds: [ new EmbedBuilder().setColor('#ff0000').setDescription(`❌ | You are not in the same Voice Channel`)], ephemeral: true, })
       }
    // check if command is of type SlashCommand that extends SlashCommandBuilder
    if (command instanceof SlashCommand) {
       try {
        // check command cooldown
        let userCD;
        const cooldowns = client.cooldowns.get(command_name);
        if (cooldowns) {
            userCD = cooldowns.filter((cd) => cd.userID === user.id);
            if (userCD.length == 1) {
                userCD = userCD[0];
                const cur_time = new Date();
                const cmd_time = userCD.per;
                if (cur_time.getTime() <= cmd_time.getTime()) {
                    return await inter.reply(
                        `command on cooldown, retry after ` +
                            `\`${time_convertor(cmd_time - cur_time)}\``
                    );
                } else
                    delete cooldowns[
                        cooldowns.findIndex((cd) => cd.userID === user.id)
                    ];
            }
        }
        await command.execute({ inter, client })

        // create command cooldown
        if (cooldowns) {
            userCD = cooldowns.filter((cd) => cd.userID === user.id);
            if (userCD.length == 0) {
                const new_date = new Date();
                new_date.setSeconds(new_date.getSeconds() + command.per);
                cooldowns.push({ userID: user.id, per: new_date });
            }
        }
    } catch (error) {
        console.error(error);
        const err_msg = {
            content: "something went wrong, try again later",
            ephemeral: true,
        };
        if (inter.deferred) await inter.followUp(err_msg);
        else {
            await inter.deferReply();
            await inter.reply(err_msg);
        }
    }
}
else {
    command.execute({ inter, client });
}
    }
    
    // check if command is not of type SlashCommand that extends SlashCommandBuilder

    if (inter.type === InteractionType.MessageComponent) {
        try {
        const customId = JSON.parse(inter.customId)
        const file_of_button = customId.ffb
        const queue = player.nodes.get(inter.guildId);
        if (file_of_button) {
            delete require.cache[require.resolve(`../src/buttons/${file_of_button}.js`)];
            const button = require(`../src/buttons/${file_of_button}.js`)
            if (button) return button({ client, inter, customId, queue });
        }
    } catch (error) {
        console.error(error);
        const err_msg = {
            content: "something went wrong, try again later",
            ephemeral: true,
        };
        if (inter.deferred) await inter.followUp(err_msg);
        else {
            await inter.deferReply();
            await inter.reply(err_msg);
        }
    }
    }
};