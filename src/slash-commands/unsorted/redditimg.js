/*
    Command to test the bot's hosting ping
*/
const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("redditimg")
    .setDescription("Get a random image from a subreddit"),
  async execute({ client, inter }) {
    const m = await inter.reply("Ping?");
    inter.editReply(`Pong! ${inter.client.ws.ping} ms`);
  },
};
