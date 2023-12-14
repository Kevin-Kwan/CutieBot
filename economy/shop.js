const { SlashCommand } = require('../base.js')
const { shop_items, open_inv } = require('../modules/inventory_funcs.js')

const Math = require('mathjs')
const { EmbedBuilder, inter } = require('discord.js')

const shop = new SlashCommand()
  .setName('shop')
  .setDescription('get the shop items')
  .addStringOption((option) =>
    option
      .setName('item_name')
      .setDescription('get the item information')
      .setRequired(false)
  )
  .setDMPermission(false)
shop.callback(
  /**
   *
   * @param {inter} inter
   * @returns
   */
  async ({ inter }) => {
    await inter.deferReply()
    const user = inter.user
    let info = inter.options.getString('item_name', false)

    await open_inv(user)
    if (info !== null) {
      info = info.trim().toLowerCase()
      for (const item of shop_items) {
        const name = item.name
        const cost = item.cost
        const item_info = item.info

        if (name.toLowerCase() == info) {
          const sell_amt = Math.round(cost / 4)
          const em = new EmbedBuilder()
            .setTitle(name.toUpperCase())
            .setDescription(item_info)
            .addFields(
              {
                name: 'Buying price',
                value: `${cost}`,
                inline: false
              },
              {
                name: 'Selling price',
                value: `${sell_amt}`,
                inline: false
              }
            )
          return await inter.followUp({ embeds: [em] })
        }
      }
    } else {
      const em = new EmbedBuilder()
        .setTitle('SHOP')
        .setDescription('Items will appear here')

      let x = 1
      for (const item of shop_items) {
        const name = item.name
        const cost = item.cost
        const item_id = item.id
        const item_info = item.info

        x += 1
        if (x > 1) {
          em.addFields({
            name: `${name.toUpperCase()} -- $ ${cost}`,
            value: `${item_info}\nID: \`${item_id}\``,
            inline: false
          })
        }
      }

      await inter.followUp({ embeds: [em] })
    }
  }
)

module.exports = {
  setup: () => {
    console.log(`- ${__filename.slice(__dirname.length + 1)}`)
  }
}
