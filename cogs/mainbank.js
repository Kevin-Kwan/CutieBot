const { SlashCommand } = require("../base.js");
const {
    open_bank,
    get_bank_data,
    update_bank,
    get_networth_lb,
} = require("../modules/bank_funcs.js");

const { EmbedBuilder, userMention, BitField, PermissionFlagsBits } = require("discord.js");

const balance = new SlashCommand()
    .setName("balance")
    .setDescription("get bank balance")
    .addUserOption((option) =>
        option
            .setName("member")
            .setDescription("target @member")
            .setRequired(false)
    )
    .setDMPermission(false);
balance.callback(async ({inter}) => {
    await inter.deferReply();
    const member = inter.options.getUser("member", false);
    const user = member || inter.user;
    if (user.bot) return await inter.followUp("Bots don't have account");
    await open_bank(user);

    const users = await get_bank_data(user);
    const wallet_amt = users[1];
    const bank_amt = users[2];
    let net_amt = wallet_amt + bank_amt;

    const em = new EmbedBuilder()
        .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
        .setDescription(
            `Wallet: $${wallet_amt}\n` +
                `Bank: $${bank_amt}\n` +
                `Net: $${net_amt}`
        )
        .setColor(0x00ff00);

    await inter.followUp({ embeds: [em] });
});

const withdraw = new SlashCommand()
    .setName("withdraw")
    .setDescription("withdraws money from bank")
    .addStringOption((option) =>
        option
            .setName("amount")
            .setDescription("enter amount, 'all' or 'max'")
            .setRequired(true)
    )
    .setDMPermission(false);
withdraw.callback(async ({inter}) => {
    await inter.deferReply();
    const user = inter.user;
    let amount = inter.options.getString("amount");

    const users = await get_bank_data(user);
    const bank_amt = users[2];
    if (["all", "max"].includes(amount.toLowerCase())) {
        await update_bank(user, +bank_amt);
        await update_bank(user, -bank_amt, "bank");

        return await inter.followUp(
            `${userMention(user.id)} you withdrew $ ${bank_amt} to your wallet`
        );
    }

    amount = parseInt(amount);
    if (amount > bank_amt)
        return await inter.followUp(
            `${userMention(user.id)} You don't have enough money! You have $ ${bank_amt} in your bank!`
        );
    if (amount < 0)
        return await inter.followUp(
            `${userMention(user.id)} enter a valid amount!`
        );

    await update_bank(user, +amount);
    await update_bank(user, -amount, "bank");
    await inter.followUp(
        `${userMention(user.id)} you withdrew $ ${amount} from your bank`
    );
});

const deposit = new SlashCommand()
    .setName("deposit")
    .setDescription("deposit money into bank")
    .addStringOption((option) =>
        option
            .setName("amount")
            .setDescription("enter amount, 'all' or 'max'")
            .setRequired(true)
    )
    .setDMPermission(false);
deposit.callback(async ({inter}) => {
    await inter.deferReply();
    const user = inter.user;
    let amount = inter.options.getString("amount");

    const users = await get_bank_data(user);
    const wallet_amt = users[1];
    if (["all", "max"].includes(amount.toLowerCase())) {
        await update_bank(user, -wallet_amt);
        await update_bank(user, +wallet_amt, "bank");

        return await inter.followUp(
            `${userMention(user.id)} you deposited $ ${wallet_amt} in your bank`
        );
    }

    amount = parseInt(amount);
    if (amount > wallet_amt)
        return await inter.followUp(
            `${userMention(user.id)} You don't have enough money! You have $ ${wallet_amt} in your wallet!`
        );
    if (amount < 0)
        return await inter.followUp(
            `${userMention(user.id)} enter a valid amount!`
        );

    await update_bank(user, -amount);
    await update_bank(user, +amount, "bank");
    await inter.followUp(
        `${userMention(user.id)} you deposited ${amount} in your bank`
    );
});

const send = new SlashCommand()
    .setName("send")
    .setDescription("send/transfer money to a member")
    .addUserOption((option) =>
        option
            .setName("member")
            .setDescription("target @member")
            .setRequired(true)
    )
    .addIntegerOption((option) =>
        option
            .setName("amount")
            .setDescription("enter a positive integer")
            .setRequired(true)
    )
    .setDMPermission(false);
send.callback(async ({inter}) => {
    await inter.deferReply();

    const user = inter.user;
    const member = inter.options.getUser("member", true);
    const amount = inter.options.getInteger("amount", true);
    if (member.bot)
        return await inter.followUp("Bots don't have account");

    const users = await get_bank_data(user);
    const wallet_amt = await get_bank_data(user);
    if (amount <= 0) return await inter.followUp("Enter a valid amount!");
    if (amount > wallet_amt)
        return await inter.followUp("You don't have enough money! You have $ " + wallet_amt + " in your wallet!");

    await update_bank(user, -amount);
    await update_bank(member, +amount);
    await inter.followUp(
        `You sent ${amount} to ${userMention(member.id)}`
    );
});

const leaderboard = new SlashCommand()
    .setName("leaderboard")
    .setDescription("get the top members w.r.t net worth");
leaderboard.callback(async ({inter}) => {
    await inter.deferReply();

    const guild = inter.guild;
    const users = await get_networth_lb();
    let data = [];
    let index = 1;
    for (const member of users) {
        if (index > 10) break;

        const member_name = (
            await inter.client.users.cache.find((u) => u.id == member[0])
        ).tag;
        const member_amt = member[1] + member[2];
        if (index == 1) data.push(`**🥇 \`${member_name}\` -- $ ${member_amt}**`);
        if (index == 2) data.push(`**🥈 \`${member_name}\` -- $ ${member_amt}**`);
        if (index == 3) data.push(`**🥉 \`${member_name}\` -- $ ${member_amt}**`);
        if (index >= 4)
            data.push(`**${index} \`${member_name}\` -- ${member_amt}**`);
        index += 1;
    }

    msg = data.join("\n");
    const em = new EmbedBuilder()
        .setTitle(`Top ${index} Richest Users - Leaderboard`)
        .setDescription(
            "Based on Net Worth (wallet + bank) of Global Users\n\n" + msg
        )
        .setColor(0x00ff00)
        .setTimestamp()
        .setFooter({ text: `GLOBAL - ${guild.name}` });
    await inter.followUp({ embeds: [em] });
});
const add_money = new SlashCommand()
    .setName("add-money")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDescription("add money to a member")
    .addUserOption((option) =>
        option
            .setName("member")
            .setDescription("target @member")
            .setRequired(true)
    )
    .addIntegerOption((option) =>
        option
            .setName("amount")
            .setDescription("enter a positive integer")
            .setMinValue(1)
            .setRequired(true)
    )
    .setDMPermission(false);
add_money.callback(async ({inter}) => {
    await inter.deferReply();
    const member = inter.options.getUser("member", true);
    const amount = inter.options.getInteger("amount", true);
    // give money to member
    await update_bank(member, +amount);
    await inter.followUp(
        `Added $ ${amount} to ${userMention(member.id)}`
    );
});
const remove_money = new SlashCommand()
    .setName("remove-money")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDescription("remove money from a member")
    .addUserOption((option) =>
        option
            .setName("member")
            .setDescription("target @member")
            .setRequired(true)
    )
    .addIntegerOption((option) =>
        option
            .setName("amount")
            .setDescription("enter a positive integer to remove")
            .setMinValue(1)
            .setRequired(true)
    )
    .setDMPermission(false);
remove_money.callback(async ({inter}) => {
    await inter.deferReply();
    const member = inter.options.getUser("member", true);
    const amount = inter.options.getInteger("amount", true);
    // remove money from member
    await update_bank(member, -amount);
    await inter.followUp(
        `Removed $ ${amount} from ${userMention(member.id)}`
    );
});

module.exports = {
    setup: () => {
        console.log(`- ${__filename.slice(__dirname.length + 1)}`);
    },
};
