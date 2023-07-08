const { EmbedBuilder } = require("discord.js");
const prefix = process.env.PREFIX;
const subreddits = [
  "hentai",
  "rule34lol",
  "HoloLewd",
  "GenshinImpactNSFW",
  "GenshinImpactHentai",
  "SFMcompileclub",
  "ecchi",
  "pantsu",
];
const trev = require("trev");
const delay = 3000;
let sub = subreddits[Math.round(Math.random() * (subreddits.length - 1))];

module.exports = {
  run: async (client, message, args) => {
    if (message.author.bot) return;
    getImage(message, sub).catch((e) => getImage(message, sub));
    setTimeout(() => message.delete(), delay);
  },
};

async function getImage(givenMessage, subredditName) {
  sub = subreddits[Math.round(Math.random() * (subreddits.length - 1))];
  let subr = await trev.getCustomSubreddit(sub);
  if (!subr || !subr.media) {
    subr = await trev.getCustomSubreddit(sub);
  }
  const image = subr.media;
  // console.log(image);
  if (
    image.toString().includes(".png") ||
    image.toString().includes(".jpg") ||
    image.toString().includes(".jpeg") ||
    image.toString().includes(".gif")
  ) {
    const imageEmbed = new EmbedBuilder()
      .setColor(Math.floor(Math.random() * 16777215).toString(16))
      .setTitle("Random Image from r/" + sub)
      .setURL(image)
      .setImage(image);
    givenMessage.reply({ embeds: [imageEmbed] });
  } else {
    getImage(givenMessage, sub).catch((e) => getImage(givenMessage, sub));
  }
  // givenMessage.delete({timeout: delay}).catch(console.error);
}

module.exports.info = {
  name: "nsfw",
  alias: ["nsfw"],
  permission: "default",
  category: "NSFW",
  guildOnly: false,
  help: "make the bot post an nsfw image from a subreddit from the nsfw subreddits list",
};
