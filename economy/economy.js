const { SlashCommand, randint } = require("../base.js");
const {
  open_bank,
  get_bank_data,
  update_bank,
  get_networth_lb,
} = require("../modules/bank_funcs.js");

const {
  EmbedBuilder,
  userMention,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const daily = new SlashCommand()
  .setName("daily")
  .setDescription("get daily pocket money")
  .setDMPermission(false)
  .setCooldown(24 * 3600);
daily.callback(async ({ inter }) => {
  // console.log(inter)
  await inter.deferReply();
  const user = inter.user;
  await open_bank(user);

  const rand_amt = randint(3000, 5000);
  await update_bank(user, +rand_amt);
  await inter.followUp(
    `${userMention(user.id)} your daily pocket money is $ ${rand_amt}`,
  );
});

const weekly = new SlashCommand()
  .setName("weekly")
  .setDescription("get weekly pocket money")
  .setDMPermission(false)
  .setCooldown(7 * 24 * 3600);
weekly.callback(async ({ inter }) => {
  await inter.deferReply();
  const user = inter.user;
  await open_bank(user);

  const rand_amt = randint(7000, 10000);
  await update_bank(user, +rand_amt);
  await inter.followUp(
    `${userMention(user.id)} your weekly pocket money is $ ${rand_amt}`,
  );
});

const monthly = new SlashCommand()
  .setName("monthly")
  .setDescription("get monthly pocket money")
  .setDMPermission(false)
  .setCooldown(30 * 24 * 3600);
monthly.callback(async ({ inter }) => {
  await inter.deferReply();
  const user = inter.user;
  await open_bank(user);

  const rand_amt = randint(30000, 50000);
  await update_bank(user, +rand_amt);
  await inter.followUp(
    `${userMention(user.id)} your monthly pocket money is $ ${rand_amt}`,
  );
});

const pay = new SlashCommand()
  .setName("pay")
  .setDescription("pay someone")
  .addUserOption((option) =>
    option
      .setName("member")
      .setDescription("person to pay money to")
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName("amount")
      .setDescription("amount, 'all' or 'max'")
      .setRequired(true),
  )
  .setDMPermission(false);
pay.callback(async ({ inter }) => {
  await inter.deferReply();
  const user = inter.user;
  const member = inter.options.getUser("member");
  let amount = inter.options.getString("amount");
  await open_bank(user);
  const users = await get_bank_data(user);
  if (["all", "max"].includes(amount.toLowerCase())) {
    amount = users[1];
  } else {
    amount = parseInt(amount);
  }
  if (users[1] < amount) {
    return await inter.followUp(
      "You don't have enough money to pay that much! You currently have $" +
        users[1],
    );
  } else if (amount < 0) {
    return await inter.followUp("You can't pay with negative money!");
  }
  // ask for confirmation
  const embed = new EmbedBuilder()
    .setTitle("Confirm Payment")
    .setDescription(
      `Are you sure you want to pay ${userMention(member.id)} $${amount}?`,
    )
    .setColor("#F1C40F");
  // add buttons green and red
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("confirm")
      .setLabel("Confirm")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger),
  );
  // send the message
  const msg = await inter.followUp({ embeds: [embed], components: [row] });
  // wait for a button click from the user who ran the command
  const filter = (i) => i.user.id === user.id;
  // if pressed confirm button, pay the money
  const collector = msg.createMessageComponentCollector({
    filter,
    time: 15000,
  });
  collector.on("collect", async (i) => {
    if (i.customId === "confirm") {
      await update_bank(user, -amount);
      await update_bank(member, +amount);
      await i.update({
        embeds: [
          new EmbedBuilder()
            .setTitle("Payment Successful")
            .setDescription(`You paid ${userMention(member.id)} $${amount}`)
            .setColor("#F1C40F"),
        ],
        components: [],
      });
    } else if (i.customId === "cancel") {
      await i.update({
        embeds: [
          new EmbedBuilder()
            .setTitle("Payment Cancelled")
            .setDescription(
              `You cancelled the payment to ${userMention(member.id)}`,
            )
            .setColor("#F1C40F"),
        ],
        components: [],
      });
    }
  });
  collector.on("end", async (collected, reason) => {
    if (reason === "time") {
      await msg.edit({
        embeds: [
          new EmbedBuilder()
            .setTitle("Payment Cancelled")
            .setDescription(
              `You took too long to confirm the payment to ${userMention(
                member.id,
              )}`,
            )
            .setColor("#F1C40F"),
        ],
        components: [],
      });
    }
  });
});

module.exports = {
  setup: () => {
    console.log(`- ${__filename.slice(__dirname.length + 1)}`);
  },
};
