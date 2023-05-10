const Math = require("mathjs");
const {
    Client,
    GatewayIntentBits,
    Collection,
    Interaction,
    SlashCommandBuilder,
} = require("discord.js");
class SlashCommand extends SlashCommandBuilder {
    constructor() {
        super();
        this.execute = null;
        this.per = null;
    }

    setCooldown(per) {
        this.per = per;
        client.cooldowns.set(this.name, new Array());
        return this;
    }

    /**
     *
     * @param {(interaction: Interaction)} coro
     */
    callback(coro) {
        this.execute = coro;
        client.slashcommands.set(this.name, this);
    }
}

/**
 *
 * @param {number} min
 * @param {number | null} max
 * @returns
 */
function randint(min, max = null) {
    if (max === null) return Math.floor(Math.random() * min);

    return Math.floor(Math.random() * (max - min + 1) + min);
}

/**
 *
 * @param {Array} array
 * @returns
 */
function shuffle(array) {
    return array.sort(() => Math.random() - 0.5);
}

/**
 *
 * @param {number} milliseconds
 * @returns
 */
function time_convertor(milliseconds) {
    const secs_ = Math.floor(milliseconds / 1000);
    let secs = secs_;

    const days = Math.floor(secs / (24 * 3600));
    secs %= 3600 * 24;

    const hours = Math.floor(secs / 3600);
    secs %= 3600;

    const minutes = Math.floor(secs / 60);
    secs %= 60;

    const seconds = secs;
    if (secs_ <= 3600) return `${minutes}:${seconds}`;
    else if (secs_ < 24 * 3600) return `${hours}:${minutes}:${seconds}`;
    else return `${days} day(s)`;
}

module.exports = {
    SlashCommand,
    randint,
    shuffle,
    time_convertor,
};
