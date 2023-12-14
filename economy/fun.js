const { SlashCommand, randint, shuffle } = require('../base.js')

const {
  open_bank,
  get_bank_data,
  update_bank,
  get_networth_lb
} = require('../modules/bank_funcs.js')

const Math = require('mathjs')
const { EmbedBuilder, userMention } = require('discord.js')

const minBet = 1
const rouletteOdds = 0.5
const coinflip = new SlashCommand()
  .setName('coinflip')
  .setDescription('bet on tossing a coin')
  .addStringOption((option) =>
    option
      .setName('bet_on')
      .setDescription('select either heads or tails')
      .addChoices(
        { name: 'heads', value: 'heads' },
        { name: 'tails', value: 'tails' }
      )
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName('amount')
      .setDescription("enter amount, 'all' or 'max'")
      .setRequired(true)
  )
  .setDMPermission(false)
coinflip.callback(async ({ inter }) => {
  await inter.deferReply()

  const user = inter.user
  const bet_on = inter.options.getString('bet_on', true)
  let amount = inter.options.getString('amount', true)
  await open_bank(user)
  const users = await get_bank_data(user)
  if (['all', 'max'].includes(amount.toLowerCase())) {
    amount = users[1]
  } else {
    amount = parseInt(amount)
  }
  if (users[1] < amount) {
    return await inter.followUp(
      "You don't have enough money to bet that much! You currently have $" +
        users[1]
    )
  } else if (amount < 0) {
    return await inter.followUp("You can't bet negative money!")
  } else if (amount < minBet) {
    return await inter.followUp(`You need to bet at least $${minBet}`)
  }
  const reward = Math.floor(amount)

  const coin = ['heads', 'tails']
  const result = coin[randint(0, 1)]

  if (result != bet_on) {
    await update_bank(user, -amount)
    return await inter.followUp(`Got ${result}, you lost $ ${amount}`)
  }

  await update_bank(user, +reward)
  await inter.followUp(`Got ${result}, you won $ ${amount + reward}`)
})

const roulette = new SlashCommand()
  .setName('roulette')
  .setDescription('just straight up gamble')
  .addStringOption((option) =>
    option
      .setName('amount')
      .setDescription("enter amount, 'all' or 'max'")
      .setRequired(true)
  )
  .setDMPermission(false)
roulette.callback(async ({ inter }) => {
  await inter.deferReply()

  const user = inter.user
  let amount = inter.options.getString('amount', true)
  await open_bank(user)
  const users = await get_bank_data(user)
  if (['all', 'max'].includes(amount.toLowerCase())) {
    amount = users[1]
  } else {
    amount = parseInt(amount)
  }
  if (users[1] < amount) {
    return await inter.followUp(
      "You don't have enough money to bet that much! You currently have $" +
        users[1]
    )
  } else if (amount < 0) {
    return await inter.followUp("You can't bet negative money!")
  } else if (amount < minBet) {
    return await inter.followUp(`You need to bet at least $${minBet}`)
  }
  const reward = Math.floor(amount)
  //

  const result = randint(0, 1)

  if (result != 0) {
    await update_bank(user, -amount)
    return await inter.followUp(`You lost $ ${amount}`)
  }

  await update_bank(user, +reward)
  await inter.followUp(`You won $ ${amount + reward}`)
})

const rob = new SlashCommand()
  .setName('rob')
  .setDescription('attempt to steal from another person')
  .setCooldown(300) // 300 seconds
  .addUserOption((option) =>
    option
      .setName('target')
      .setDescription('select a user to steal from')
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName('amount')
      .setDescription("enter amount, 'all' or 'max'")
      .setRequired(true)
  )
  .setDMPermission(false)
rob.callback(async ({ inter }) => {
  await inter.deferReply()
  const target = inter.options.getUser('target', true)
  const user = inter.user
  let amount = inter.options.getString('amount', true)
  await open_bank(target)
  const users = await get_bank_data(target)
  if (['all', 'max'].includes(amount.toLowerCase())) {
    amount = users[1]
  } else {
    amount = parseInt(amount)
  }
  if (users[1] < amount) {
    return await inter.followUp(
      "The target doesn't have enough money to steal that much! They currently have $" +
        users[1]
    )
  } else if (amount < 0) {
    return await inter.followUp("You can't rob negative money!")
  } else if (amount < minBet) {
    return await inter.followUp(`You need to steal at least $${minBet}`)
  }

  // generate random double between 0 and 1
  const scale = Math.random()
  // 25% chance to steal nothing
  // 5% to steal 100% of the amount
  // 45% to steal a random amount between 0 and 100%
  // 25% to fail and lose $1000
  const picker = randint(0, 100)
  if (picker <= 45) {
    chosenAmountToSteal = Math.floor(scale * amount)
  } else if (picker <= 70) {
    chosenAmountToSteal = 0
  } else if (picker <= 90) {
    chosenAmountToSteal = -1000
  } else {
    chosenAmountToSteal = amount
  }
  if (chosenAmountToSteal > 0) {
    await update_bank(target, -chosenAmountToSteal)
    await update_bank(user, +chosenAmountToSteal)
    return await inter.followUp(
      `You managed to steal $${chosenAmountToSteal} from ${target.username}`
    )
  } else if (chosenAmountToSteal < 0) {
    await update_bank(user, chosenAmountToSteal)
    return await inter.followUp(
      `You failed to steal from ${target.username}! The police caught you and you had to pay $1000 for bail.`
    )
  } else {
    return await inter.followUp(`You failed to steal from ${target.username}.`)
  }
})

const slots = new SlashCommand()
  .setName('slots')
  .setDescription('spin the slots and get MONEY')
  .addStringOption((option) =>
    option
      .setName('amount')
      .setDescription("enter amount, 'all' or 'max'")
      .setRequired(true)
  )
  .setDMPermission(false)
slots.callback(async ({ inter }) => {
  await inter.deferReply()

  const user = inter.user
  let amount = inter.options.getString('amount', true)
  await open_bank(user)
  const users = await get_bank_data(user)
  if (['all', 'max'].includes(amount.toLowerCase())) {
    amount = users[1]
  } else {
    amount = parseInt(amount)
  }
  if (users[1] < amount) {
    return await inter.followUp(
      "You don't have enough money to bet that much! You currently have $" +
        users[1]
    )
  } else if (amount < 0) {
    return await inter.followUp("You can't bet negative money!")
  } else if (amount < minBet) {
    return await inter.followUp(`You need to bet at least $${minBet}`)
  }

  let slot1 = ['💝', '🎉', '💎', '💵', '💰', '🚀', '🍿']
  let slot2 = ['💝', '🎉', '💎', '💵', '💰', '🚀', '🍿']
  let slot3 = ['💝', '🎉', '💎', '💵', '💰', '🚀', '🍿']
  const sep = ' | '
  const total = slot1.length

  slot1 = shuffle(slot1)
  slot2 = shuffle(slot2)
  slot3 = shuffle(slot3)

  let mid
  if (total % 2 == 0) {
    // if even
    mid = Math.floor(total / 2)
  } else mid = Math.floor((total + 1) / 2)

  const result = []
  for (let x = 0; x < total; x++) result.push([slot1[x], slot2[x], slot3[x]])

  const em = new EmbedBuilder().setDescription(
    '```' +
      `| ${result[mid - 1].join(sep)} |\n` +
      `| ${result[mid].join(sep)} | 📍\n` +
      `| ${result[mid + 1].join(sep)} |\n` +
      '```'
  )

  const slot = result[mid]
  const s1 = slot[0]
  const s2 = slot[1]
  const s3 = slot[2]

  let reward, content
  if (s1 == s2 && s2 == s3 && s1 == s3) {
    reward = Math.floor(amount)
    await update_bank(user, +reward)
    content = `Jackpot! you won $ ${amount + reward}`
  } else if (s1 == s2 || s2 == s3 || s1 == s3) {
    reward = Math.floor(amount / 2)
    await update_bank(user, +reward)
    content = `GG! you only won $ ${amount + reward}`
  } else {
    await update_bank(user, -amount)
    content = `You lost $ ${amount}`
  }

  await inter.followUp({ content, embeds: [em] })
})

// const blackjack = new SlashCommand()
//     .setName("blackjack")
//     .setDescription("play blackjack with the bot")
//     .addStringOption((option) =>
//         option
//             .setName("amount")
//             .setDescription("enter amount, 'all' or 'max'")
//             .setMinValue(1000)
//             .setMaxValue(10000)
//             .setRequired(true)
//     )
//     .setDMPermission(false);
// // blackjack.callback(async ({inter}) => {
// //     await inter.deferReply();
//     const maxBet = await get_bank_data(inter.user)[1];
//     coinflip.options[1].setMaxValue(maxBet);

//     const user = inter.user;
//     const amount = parseInt(amount);

//     await open_bank(user);
//     if (!(amount >= 1000 && amount <= 10000))
//         return await inter.followUp(
//             "You can only bet amount between 1000 and 10000"
//         );

//     const users = await get_bank_data(user);
//     if (users[1] < amount)
//         return await inter.followUp("You don't have enough money to bet that much! You currently have $" + users[1])
//     // create a deck of cards with emojis mapped to their values
//     const deck = [
//         "🂡", // ace of spades value of 1
//         "🂢", // 2 of spades value of 2
//         "🂣", // 3 of spades value of 3
//         "🂤", // 4 of spades value of 4
//         "🂥", // 5 of spades value of 5
//         "🂦", // 6 of spades value of 6
//         "🂧", // 7 of spades value of 7
//         "🂨", // 8 of spades value of 8
//         "🂩", // 9 of spades value of 9
//         "🂪", // 10 of spades value of 10
//         "🂫", // jack of spades value of 10
//         "🂭", // queen of spades value of 10
//         "🂮", // king of spades value of 10
//         "🂱", // ace of hearts value of 1
//         "🂲", // 2 of hearts value of 2
//         "🂳", // 3 of hearts value of 3
//         "🂴", // 4 of hearts value of 4
//         "🂵", // 5 of hearts value of 5
//         "🂶", // 6 of hearts value of 6
//         "🂷", // 7 of hearts value of 7
//         "🂸", // 8 of hearts value of 8
//         "🂹", // 9 of hearts value of 9
//         "🂺", // 10 of hearts value of 10
//         "🂻", // jack of hearts value of 10
//         "🂽", // queen of hearts value of 10
//         "🂾", // king of hearts value of 10
//         "🃁", // ace of diamonds value of 1
//         "🃂", // 2 of diamonds value of 2
//         "🃃", // 3 of diamonds value of 3
//         "🃄", // 4 of diamonds value of 4
//         "🃅", // 5 of diamonds value of 5
//         "🃆", // 6 of diamonds value of 6
//         "🃇", // 7 of diamonds value of 7
//         "🃈", // 8 of diamonds value of 8
//         "🃉", // 9 of diamonds value of 9
//         "🃊", // 10 of diamonds value of 10
//         "🃋", // jack of diamonds value of 10
//         "🃍", // queen of diamonds value of 10
//         "🃎", // king of diamonds value of 10
//         "🃑", // ace of clubs value of 1
//         "🃒", // 2 of clubs value of 2
//         "🃓", // 3 of clubs value of 3
//         "🃔", // 4 of clubs value of 4
//         "🃕", // 5 of clubs value of 5
//         "🃖", // 6 of clubs value of 6
//         "🃗", // 7 of clubs value of 7
//         "🃘", // 8 of clubs value of 8
//         "🃙", // 9 of clubs value of 9
//         "🃚", // 10 of clubs value of 10
//         "🃛", // jack of clubs value of 10
//         "🃝", // queen of clubs value of 10
//         "🃞", // king of clubs value of 10
//     ];
//     // implement blackjack
//     const player = [];
//     const dealer = [];
//     const player_value = 0;
//     const dealer_value = 0;
//     // deal 2 cards to player and dealer
//     for (let i = 0; i < 2; i++) {
//         player.push(deck[Math.floor(Math.random() * deck.length)]);
//         dealer.push(deck[Math.floor(Math.random() * deck.length)]);
//     }
//     // create a function to calculate the value of the cards according to blackjack rules
//     const calculate = (cards) => {
//         let value = 0;
//         for (const card of cards) {
//             if (card === "🂡" || card === "🂱" || card === "🃁" || card === "🃑")
//                 value += 1;
//             else if (
//                 card === "🂢" ||
//                 card === "🂲" ||
//                 card === "🃂" ||
//                 card === "🃒"
//             )
//                 value += 2;
//             else if (
//                 card === "🂣" ||
//                 card === "🂳" ||
//                 card === "🃃" ||
//                 card === "🃓"
//             )
//                 value += 3;
//             else if (
//                 card === "🂤" ||
//                 card === "🂴" ||
//                 card === "🃄" ||
//                 card === "🃔"
//             )
//                 value += 4;
//             else if (
//                 card === "🂥" ||
//                 card === "🂵" ||
//                 card === "🃅" ||
//                 card === "🃕"
//             )
//                 value += 5;
//             else if (
//                 card === "🂦" ||
//                 card === "🂶" ||
//                 card === "🃆" ||
//                 card === "🃖"
//             )
//                 value += 6;
//             else if (
//                 card === "🂧" ||
//                 card === "🂷" ||
//                 card === "🃇" ||
//                 card === "🃗"
//             )
//                 value += 7;
//             else if (
//                 card === "🂨" ||
//                 card === "🂸" ||
//                 card === "🃈" ||
//                 card === "🃘"
//             )
//                 value += 8;
//             else if (
//                 card === "🂧" ||
//                 card === "🂷" ||
//                 card === "🃇" ||
//                 card === "🃗"
//             )
//                 value += 7;
//             else if (
//                 card === "🂩" ||
//                 card === "🂹" ||
//                 card === "🃉" ||
//                 card === "🃙"
//             )
//                 value += 9;
//             else if (
//                 card === "🂪" ||
//                 card === "🂺" ||
//                 card === "🃊" ||
//                 card === "🃚" )
//                 value += 10;
//             else if (
//                 card === "🂫" ||
//                 card === "🂻" ||
//                 card === "🃋" ||
//                 card === "🃛"
//             )
//                 value += 11;
//             else if (
//                 card === "🂭" ||
//                 card === "🂽" ||
//                 card === "🃍" ||
//                 card === "🃝"
//             )
//                 value += 12;
//             else if (
//                 card === "🂮" ||
//                 card === "🂾" ||
//                 card === "🃎" ||
//                 card === "🃞"
//             )
//                 value += 13;
//         }
//     }
//     const inPlay = true;
//     while (inPlay) {

// });

const dice = new SlashCommand()
  .setName('dice')
  .setDescription('bet on number drawn from a rolling dice')
  .addStringOption((option) =>
    option
      .setName('amount')
      .setDescription("enter amount, 'all' or 'max'")
      .setRequired(true)
  )
  .addIntegerOption((option) =>
    option
      .setName('bet_on')
      .setDescription('enter a number of dice, default: 6')
      .setMinValue(1)
      .setMaxValue(6)
      .setRequired(false)
  )
  .setDMPermission(false)
dice.callback(async ({ inter }) => {
  await inter.deferReply()

  const user = inter.user
  const rdice = [1, 2, 3, 4, 5, 6]
  let bet_on = inter.options.getInteger('bet_on', false)
  bet_on = bet_on || 6

  let amount = inter.options.getString('amount', true)
  await open_bank(user)
  const users = await get_bank_data(user)
  if (['all', 'max'].includes(amount.toLowerCase())) {
    amount = users[1]
  } else {
    amount = parseInt(amount)
  }
  if (users[1] < amount) {
    return await inter.followUp(
      "You don't have enough money to bet that much! You currently have $" +
        users[1]
    )
  } else if (amount < 0) {
    return await inter.followUp("You can't bet negative money!")
  } else if (amount < minBet) {
    return await inter.followUp(`You need to bet at least $${minBet}`)
  }
  const rand_num = rdice[randint(0, rdice.length)]
  if (rand_num != bet_on) {
    await update_bank(user, -amount)
    return await inter.followUp(`Got ${rand_num}, you lost $ ${amount}`)
  }

  const reward = Math.floor(amount)
  await update_bank(user, +reward)
  await inter.followUp(`Got ${rand_num}, you won $ ${amount + reward}`)
})

module.exports = {
  setup: () => {
    console.log(`- ${__filename.slice(__dirname.length + 1)}`)
  }
}
