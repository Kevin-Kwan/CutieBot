const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const prefix = process.env.PREFIX
var subreddits = ['hentai', 'rule34lol', 'HoloLewd', 'GenshinImpactNSFW', 'GenshinImpactHentai', 'SFMcompileclub']
const trev = require('trev');
var delay = 3000;
var sub = subreddits[Math.round(Math.random() * (subreddits.length - 1))];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('nsfw')
        .setDescription('make the bot post lewd images from this subreddit ;)'),
    async execute(interaction) {
        await interaction.reply('Pong!');
    },

    run: async (client, message, args) => {
    if (message.author.bot) return;
    getImage(message, sub).catch(e => getImage(message, sub));
    setTimeout(() => message.delete(), delay)
    },
};


async function getImage(givenMessage, subredditName)
{
    sub = subreddits[Math.round(Math.random() * (subreddits.length - 1))];
    let subr = await trev.getCustomSubreddit(sub);
    if (!subr || !subr.media) {
        subr = await trev.getCustomSubreddit(sub);
    }
    let image = subr.media;
    //console.log(image);
    if ((image.toString()).includes(".png") || (image.toString()).includes(".jpg") || (image.toString()).includes(".jpeg") || (image.toString()).includes(".gif")) {
        const imageEmbed = new EmbedBuilder()
            .setColor(Math.floor(Math.random() * 16777215).toString(16))
            .setTitle('Random Image from r/'+sub)
            .setURL(image)
            .setImage(image);
        givenMessage.reply({ embeds: [imageEmbed] });
    } else {
        getImage(givenMessage, sub).catch(e => getImage(givenMessage, sub));
    }
    //givenMessage.delete({timeout: delay}).catch(console.error);

}

module.exports.info = {
    name: "nsfw",
    alias: ["nsfw"],
    permission: "default",
    category: "NSFW",
    guildOnly: false,
	help: "make the bot post an nsfw image from a subreddit from the nsfw subreddits list"
};