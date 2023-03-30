const { Player } = require('discord-player');
const { Client, IntentsBitField, PermissionsBitField, EmbedBuilder, Partials , ActivityType } = require('discord.js');
const { Collection, Events, GatewayIntentBits, Discord } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const { Configuration, OpenAIApi } = require("openai");


var history, mainChannel, testChannel, ai, txt
var historyLen = 2000


// Importing this allows you to access the environment variables of the running node process
require('dotenv').config();
const myIntents = new IntentsBitField();
myIntents.add(
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMembers,
    IntentsBitField.Flags.GuildBans,
    IntentsBitField.Flags.GuildEmojisAndStickers,
    IntentsBitField.Flags.GuildIntegrations,
    IntentsBitField.Flags.GuildWebhooks,
    IntentsBitField.Flags.GuildInvites,
    IntentsBitField.Flags.GuildVoiceStates,
    IntentsBitField.Flags.GuildPresences,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.GuildMessageReactions,
    IntentsBitField.Flags.GuildMessageTyping,
    IntentsBitField.Flags.DirectMessages,
    IntentsBitField.Flags.DirectMessageReactions,
    IntentsBitField.Flags.DirectMessageTyping,
    IntentsBitField.Flags.MessageContent,
    IntentsBitField.Flags.GuildScheduledEvents
    )
global.client = new Client(
    { intents: myIntents },
    { partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction,
        Partials.User,
        Partials.GuildMember,
        Partials.GuildScheduledEvent,
        Partials.ThreadMember] });

// 'process.env' accesses the environment variables for the running node process
const prefix = process.env.PREFIX;
const owner = process.env.OWNER;
let usernum = client.guilds.cache.reduce((a, g) => a + g.memberCount, 0)
let guildnum = client.guilds.cache.size;
client.slashcommands = new Collection();
const port = process.env.PORT;
client.commands = [];
const configuration = new Configuration({
	apiKey: process.env.OPENAI_API_KEY, //openai
});
const openai = new OpenAIApi(configuration);

const commandsPath = path.join(__dirname, 'src/commands');
const slashCommandsPath = path.join(__dirname, 'src/slash-commands');
const slashCommandFiles = fs.readdirSync(slashCommandsPath).filter(file => file.endsWith('.js'));
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
	const filePath = path.join(commandsPath, file);
	const command = require(filePath);
	// add the command to the collection
    client.commands.push(command);
}

for (const file of slashCommandFiles) {
    const filePath = path.join(slashCommandsPath, file);
    const command = require(filePath);
    // Set a new item in the Collection with the key as the command name and the value as the exported module
    if ('data' in command && 'execute' in command) {
        client.slashcommands.set(command.data.name, command);
        console.log(`[INFO] Loaded slash command ${command.data.name} from ${filePath}.`)
    } else {
        console.log(`[WARNING] The slash command at ${filePath} is missing a required "data" or "execute" property.`);
    }
}

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  storeNumbers();
  // 
  client.user.setActivity("" + prefix + "help | Cutie has awoken!", { type: ActivityType.Streaming, url: 'https://www.twitch.tv/KoolKev246' });
  setInterval(() => {
    storeNumbers();
    let activities = [
        //"<help | discord.koolkev246.com",
        "<help | koolkev246.com",
        //"<help | invite.gg/GSMST",
        "" + prefix + "help | Managing " + guildnum + " guilds!",
        "" + guildnum + " servers | " + usernum +" users",
        "" + prefix + "help | " + usernum + " users",
        "" + prefix + "help | " + process.env.TWITCH,
        //"<help | discord.gg/uE2Enuv",
        "" + process.env.TWITCH,
        "" + process.env.INSTAGRAM,
        "" + process.env.TWITTER
      ];
    const randomIndex = Math.floor(Math.random() * (activities.length - 1) + 1);
    const newActivity = activities[randomIndex];
    client.user.setActivity(newActivity, {type: ActivityType.Streaming, url: 'https://www.twitch.tv/KoolKev246' });
    //console.log(usernum+" users in "+guildnum+" guilds!");
  }, 120000);
  console.log(usernum+" users in "+guildnum+" guilds!");
});

function splitTextIntoChunks(text, maxLength = 2000) {
    //console.log(text)
        const words = text.split(' ');
        const chunks = [];
        let currentChunk = '';
    
        for (const word of words) {
            if (currentChunk.length + word.length + 1 > maxLength) {
                chunks.push(currentChunk);
                currentChunk = '';
            }
            if (currentChunk.length > 0) {
                currentChunk += ' ';
            }
            currentChunk += word;
        }
        if (currentChunk.length > 0) {
            chunks.push(currentChunk);
        }
        return chunks;
    }

// exports.commands = () => {
//     return client.commands;
// }

// // add all commands
// // todo: add error checking
// // todo: add subfolder search support
// let success = 0;
// let fail = 0;
// client.commands = [];
// fs.readdir("./src/commands/", function(err, files){
//     files.forEach(f => {
//         const cmd = require(`./src/commands/${f}`);
//         client.commands.push(cmd) ? success++ : fail++;
//     });
// });
client.config = require('./config');

global.player = new Player(client, client.config.opt.discordPlayer);

require('./src/loader');
require('./src/events');

console.log('Commands loaded.');

// commented out because interactions are now handled differently through interactionCreate.js
// client.on(Events.InteractionCreate, async interaction => {
// 	if (!interaction.isChatInputCommand()) return;

// 	const command = client.slashcommands.get(interaction.commandName);

// 	if (!command) return;

// 	try {
// 		await command.execute(interaction);
// 	} catch (error) {
// 		console.error(error);
// 		await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
// 	}
// });

// todo: log people's dms to bot
var messages =  []
var ai
var repeater;
client.on('messageCreate', async (message) =>{
	if (message.content == "hi"){
        if (message.author.bot) return;
        message.reply("whaddup!")
    }
    if (message.content.startsWith(prefix)) {
        //console.log("command detected")
        const args = message.content.slice(prefix.length).split(/ +/);
        const cmdName = args.shift().toLowerCase();
        //console.log(cmdName)
        //console.log(client.commands)
        client.commands.forEach(command => {
            //console.log(command.info.name)
		if(cmdName === command.info.name || command.info.alias.includes(cmdName)){
            //console.log("command detected")
            //guild or private chat check (this no longer works? dunno why)
            // if(command.info.guildOnly){
            //     message.channel.send("This command is unavailable in private chat :^(");
            // }
            //admin check
            if(command.info.permission == "owner" && message.author.id != owner){
                message.reply("sorry lil bro owner only command :^)");
            }
            else if(command.info.permission == "admin" && !message.member.permissionsIn(message.channel).has(PermissionsBitField.Flags.Administrator))
            {
                message.reply("sorry lil bro admin only command :^)");
            }
            else if(command.info.category == "NSFW" && !message.channel.nsfw)
            {
                const replyEmbed = new EmbedBuilder()
                    .setColor(Math.floor(Math.random() * 16777215).toString(16))
                    .setTitle('Error Retrieving Image!')
                    .setDescription('This command can only be used in an nsfw channel!')
                message.reply({ embeds: [replyEmbed] });
            }
			else{
                command.run (client, message, args);
            }
        }
    });
    } else {
        txt = message.content.replace(/[\\$'"]/g, "\\$&")
        // create array of strings to serve as triggers for the bot
        var triggers = ['hey cutie,', 'hey cutie', 'cutie:', 'cutie,', 'cutie?', 'cutie ', 'cutie']
        // check if any of the triggers are in the message
        var trigger = triggers.find(trigger => message.content.toLowerCase().includes(trigger))


        if(trigger || message.mentions.has(client.user.id)) {
            message.channel.sendTyping()
            if(message.author.tag.includes('Cutie ❤ v2#1741')) {return false;} //bots name

            if(message.content.toLowerCase().includes('forget everything' || 'clear history' || 'clear chat history')){
                messages =  []
                message.reply('i kinda feel funy ;o')
                return false
            }

            if(message.author.id.includes('436084153503711232')){
                //console.log('self')
                return false
            }
            // replace the trigger with nothing
            txt = txt.replace(trigger, "");
            // if the bot was mentioned, remove the mention
            txt = txt.replace("<@927315876036898866> ", "");
            txt = txt.replace("<@927315876036898866>", "");
            
            messages.push({'role': 'user', 'content': txt})
            //console.log(txt);
            // log the prompt from chat gpt
            //console.log(messages)
            
            try{
                ai = await openai.createChatCompletion({
                'model': "gpt-3.5-turbo",
                'messages': messages,
                'temperature' : 1,
                'n' : 1,
                'max_tokens': 1000,
                'user' : message.author.id
                });
                //console.log(ai)
            } catch(error) {
                message.reply('error')
                // console.log(error)
                // console.log(error.response.status);
                // console.log(error.response.data);
                // console.log(error.message);
            }
            
            if(ai.data.choices[0].message){
                let response = ai.data.choices[0].message
                console.log("response ",response.content)
                // log the usage from chat gpt response

                var chunks = splitTextIntoChunks(response.content, 2000);
                    let i = 0
                    while (i < chunks.length) {
                        const chunk = chunks[i];
                        try{
                            message.reply(chunk)
                        } catch(error){
                            message.reply('i tried to say something but discord wouldnt let me ;[')
                            // console.log(error)
                        }
                        i++;
                    }
                    //console.log(ai)
                    console.log(ai.data.usage)
                    console.log(messages)
                }
        }
    }
});

// prob need a better error handler idk
process.on('unhandledRejection', error => {
	console.error('Unhandled promise rejection:', error);
    // this conflicts with the ban command, needs debugging
});

function storeNumbers() {
usernum = client.guilds.cache.reduce((a, g) => a + g.memberCount, 0)
guildnum = client.guilds.cache.size;
}

function getUserFromMention(mention) {
	if (!mention) return;

	if (mention.startsWith('<@') && mention.endsWith('>')) {
		mention = mention.slice(2, -1);

		if (mention.startsWith('!')) {
			mention = mention.slice(1);
		}

		return client.users.cache.get(mention);
	}
}


// attempts to login the bot with the environment variable you set for your bot token (either 'CLIENT_TOKEN' or 'DISCORD_TOKEN')
client.login();
