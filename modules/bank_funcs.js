require('dotenv').config()

const { User } = require('discord.js')
const { MongoClient, ServerApiVersion } = require('mongodb')

const conn = new MongoClient(process.env.CLUSTER_AUTH_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1
})

const TABLE_NAME = 'bank'

// You can add as many columns as you can in this list !!!
const document = {
  _id: null,
  wallet: 5000,
  bank: 0
}

class Database {
  async connect () {
    await conn.connect()
  }

  cursor () {
    return conn.db(process.env.DB_NAME)
  }

  destroy () {
    conn.close()
  }
}

const DB = new Database()

async function create_table () {
  const db = DB.cursor()
  let collections = await db.collections()
  collections = collections.map((vl) => vl.collectionName)
  if (!collections.includes(TABLE_NAME)) {
    await db.createCollection(TABLE_NAME)
  }
}

/**
 *
 * @param {User} user
 */
async function open_bank (user) {
  const cursor = DB.cursor().collection(TABLE_NAME)
  const user_data = await cursor.findOne({ _id: user.id })

  if (user_data === null) {
    const doc = { ...document }
    doc._id = user.id
    cursor.insertOne(doc)
  }
}

/**
 *
 * @param {User} user
 * @returns
 */
async function get_bank_data (user) {
  const cursor = DB.cursor().collection(TABLE_NAME)

  const user_data = await cursor.findOne({ _id: user.id })
  return Object.values(user_data)
}

/**
 *
 * @param {User} user
 * @param {number} amount
 * @param {string} mode
 * @returns
 */
async function update_bank (user, amount, mode = 'wallet') {
  const cursor = DB.cursor().collection(TABLE_NAME)
  const payload = {}
  payload[mode] = amount

  await cursor.updateOne({ _id: user.id }, { $inc: payload })

  const doc = { _id: 0 }
  doc[mode] = 1
  const user_data = await cursor.findOne({ _id: user.id }, doc)
  return Object.values(user_data)
}

async function get_networth_lb () {
  const cursor = DB.cursor().collection(TABLE_NAME)
  user_data = cursor.aggregate([
    { $addFields: { sum: { $add: ['$wallet', '$bank'] } } },
    { $sort: { sum: -1 } }
  ])
  const sorted_data = []
  for (const val of await user_data.toArray()) {
    sorted_data.push(Object.values(val))
  }

  return sorted_data
}

module.exports = {
  DB,
  create_table,
  open_bank,
  get_bank_data,
  update_bank,
  get_networth_lb
}
