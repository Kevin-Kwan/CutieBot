const { DB } = require("../modules/bank_funcs.js");

const { User } = require("discord.js");

const TABLE_NAME = "inventory";

const shop_items = [
    { name: "watch", cost: 100, id: 1, info: "It's a watch" },
    { name: "mobile", cost: 1000, id: 2, info: "It's a mobile" },
    { name: "laptop", cost: 10000, id: 3, info: "It's a laptop" },
    // You can add your items here ...
];
const item_names = shop_items.map((item) => item.name);

async function create_table() {
    const db = DB.cursor();
    let collections = await db.collections();
    collections = collections.map((vl) => vl.collectionName);
    if (!collections.includes(TABLE_NAME)) {
        await db.createCollection(TABLE_NAME);
    }
}

/**
 *
 * @param {User} user
 */
async function open_inv(user) {
    let doc = { _id: user.id };

    const cursor = DB.cursor().collection(TABLE_NAME);
    const user_data = await cursor.findOne({ _id: user.id });
    if (user_data === null) {
        for (const name of item_names) doc[name] = 0;
        cursor.insertOne(doc);
    }
}

/**
 *
 * @param {User} user
 * @param {string | null} mode
 * @returns
 */
async function get_inv_data(user, mode = null) {
    let user_data = null;
    const cursor = DB.cursor().collection(TABLE_NAME);
    if (mode === null) user_data = await cursor.findOne({ _id: user.id });
    else {
        const payload = {};
        payload[mode] = 1;
        user_data = await cursor.findOne(
            { _id: user.id },
            { projection: payload }
        );
    }
    return Object.values(user_data);
}

/**
 *
 * @param {User} user
 * @param {number} amount
 * @param {string} mode
 * @returns
 */
async function update_inv(user, amount, mode = "wallet") {
    const cursor = DB.cursor().collection(TABLE_NAME);
    const payload = {};
    payload[mode] = amount;

    await cursor.updateOne({ _id: user.id }, { $inc: payload });

    const doc = {};
    doc._id = 0;
    doc[mode] = 1;
    const user_data = await cursor.findOne(
        { _id: user.id },
        { projection: doc }
    );
    return Object.values(user_data);
}

/**
 *
 * @param {User} user
 * @param {number} amount
 * @param {string} mode
 * @returns
 */
async function change_inv(user, amount, mode = "wallet") {
    const cursor = DB.cursor().collection(TABLE_NAME);
    let payload = {};
    payload[mode] = amount;

    await cursor.updateOne({ _id: user.id }, { $set: payload });

    const doc = { _id: 0 };
    doc[mode] = 1;
    const user_data = await cursor.findOne(
        { _id: user.id },
        { projection: doc }
    );
    return Object.values(user_data);
}

module.exports = {
    shop_items,
    create_table,
    open_inv,
    get_inv_data,
    update_inv,
    change_inv,
};
