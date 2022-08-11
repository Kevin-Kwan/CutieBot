const { EmbedBuilder } = require('discord.js');
const prefix = process.env.PREFIX
var subreddits = ['hentai', 'rule34lol', 'ecchi', 'pantsu', 'HoloLewd', 'GenshinImpactNSFW', 'GenshinImpactHentai']
const trev = require('trev');
var delay = 3000;
var sub = subreddits[Math.round(Math.random() * (subreddits.length - 1))];

module.exports.execute = (client, message, args) => {
    if (message.author.bot) return;
    //nsfw command
    // check if channel is nsfw
    if (message.channel.nsfw) {
        getImage(message, sub)
 
        
    } else {
        const replyEmbed = new EmbedBuilder()
            .setColor(Math.floor(Math.random() * 16777215).toString(16))
            .setTitle('Error Retrieving Image!')
            .setDescription('This command can only be used in an nsfw channel!')
        message.reply({ embeds: [replyEmbed] });
    }
    setTimeout(() => message.delete(), delay)
    }


async function getImage(givenMessage, subredditName)
{
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
        getImage(givenMessage, sub);
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