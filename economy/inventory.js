const { SlashCommand } = require('../base.js')
const {
  open_bank,
  get_bank_data,
  update_bank
} = require('../modules/bank_funcs.js')
const {
  shop_items,
  open_inv,
  get_inv_data,
  update_inv
} = require('../modules/inventory_funcs.js')

const { EmbedBuilder, userMention } = require('discord.js')
const Math = require('mathjs')

const inventory = new SlashCommand()
  .setName('inventory')
  .setDescription('get your item list')
  .addUserOption((option) =>
    option
      .setName('member')
      .setDescription('target @member')
      .setRequired(false)
  )
  .setDMPermission(false)
inventory.callback(async ({ inter }) => {
  await inter.deferReply()

  const member = inter.options.getUser('member', false)
  const user = member || inter.user
  if (user.bot) return await inter.followUp("Bot's don't have account")

  await open_inv(user)

  const em = new EmbedBuilder().setColor(0x00ff00)
  let x = 1
  for (const item of shop_items) {
    const name = item.name
    const item_id = item.id

    const data = await update_inv(user, 0, name)
    if (data[0] >= 1) {
      x += 1
      em.addFields({
        name: `${name.toUpperCase()} - ${data[0]}`,
        value: `ID: ${item_id}`,
        inline: false
      })
    }
  }

  em.setAuthor({
    name: `${user.username}'s Inventory`,
    iconURL: user.displayAvatarURL()
  })
  if (x == 1) em.setDescription('The items which you bought display here...')

  await inter.followUp({ embeds: [em] })
})

const buy = new SlashCommand()
  .setName('buy')
  .setDescription('buy a item from shop')
  .addStringOption((option) =>
    option
      .setName('item_name')
      .setDescription('enter a item name from the shop')
      .setRequired(true)
  )
  .setDMPermission(false)
buy.callback(async ({ inter }) => {
  await inter.deferReply()
  const user = inter.user
  const item_name = inter.options.getString('item_name').trim().toLowerCase()

  await open_bank(user)
  if (!shop_items.map((item) => item.name.toLowerCase()).includes(item_name)) {
    return await inter.followUp(
      `${userMention(user.id)} theirs no item named \`${item_name}\``
    )
  }

  const users = await get_bank_data(user)
  for (const item of shop_items) {
    if (item_name == item.name.toLowerCase()) {
      if (users[1] < item.cost) {
        return await inter.followUp(
          `${userMention(user.id)} you don't have enough money to buy ${
            item.name
          }`
        )
      }

      await open_inv(user)
      await update_inv(user, +1, item.name)
      await update_bank(user, -item.cost)
      return await inter.followUp(
        `${userMention(user.id)} you bought ${item_name}`
      )
    }
  }
})

const sell = new SlashCommand()
  .setName('sell')
  .setDescription('get your item list')
  .addStringOption((option) =>
    option
      .setName('item_name')
      .setDescription('sell a item from your inventory')
      .setRequired(true)
  )
  .setDMPermission(false)
sell.callback(async ({ inter }) => {
  await inter.deferReply()
  const user = inter.user
  const item_name = inter.options.getString('item_name').trim().toLowerCase()
  await open_bank(user)

  if (!shop_items.map((item) => item.name.toLowerCase()).includes(item_name)) {
    return await inter.followUp(
      `${userMention(user.id)} theirs no item named \`${item_name}\``
    )
  }

  for (const item of shop_items) {
    if (item_name == item.name.toLowerCase()) {
      const cost = Math.round(item.cost / 4)
      const quantity = await update_inv(user, 0, item.name)
      if (quantity[0] < 1) {
        return await inter.followUp(
          `${userMention(user.id)} you don't have ${
            item.name
          } in your inventory`
        )
      }

      await open_inv(user)
      await update_inv(user, -1, item.name)
      await update_bank(user, +cost)
      return await inter.followUp(
        `${userMention(user.id)} you sold ${item_name} for $ ${cost}`
      )
    }
  }
})

module.exports = {
  setup: () => {
    console.log(`- ${__filename.slice(__dirname.length + 1)}`)
  }
}
