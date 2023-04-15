// This file handles loading for slash commands.

const { readdirSync } = require('fs');
const { Collection, REST, Routes } = require('discord.js');
require('dotenv').config();
const guildId = String(process.env.GUILD_ID);
const guildIds = guildId.split(',');
console.log(guildIds)

CommandsArray = [];



const events = readdirSync('./events/').filter(file => file.endsWith('.js'));

console.log(`Loading events...`);

for (const file of events) {
    const event = require(`../events/${file}`);
    console.log(`-> [Loaded Event] ${file.split('.')[0]}`);
    client.on(file.split('.')[0], event.bind(null, client));
    delete require.cache[require.resolve(`../events/${file}`)];
};

console.log(`Loading commands...`);
for (const command of client.slashcommands.values()) {
    CommandsArray.push(command.toJSON());
    client.slashcommands.set(command.name.toLowerCase(), command);
    console.log(`-> [Loaded Command] ${command.name.toLowerCase()}`);
}
// load from slash-commands
readdirSync('./src/slash-commands/').forEach(dirs => {
    const commands = readdirSync(`./src/slash-commands/${dirs}`).filter(files => files.endsWith('.js'));

    for (const file of commands) {
        const command = require(`../src/slash-commands/${dirs}/${file}`);
        if (command.name && command.description) {
        CommandsArray.push(command);
        console.log(`-> [Loaded Command] ${command.name.toLowerCase()}`);
        client.slashcommands.set(command.name.toLowerCase(), command);
        delete require.cache[require.resolve(`../src/slash-commands/${dirs}/${file}`)];
        } else {
            CommandsArray.push(command.data.toJSON());
            client.slashcommands.set(command.data.name.toLowerCase(), command);
            console.log(`-> [Old Command] ${command.data.name.toLowerCase()}`);
            //delete require.cache[require.resolve(`../src/slash-commands/${dirs}/${file}`)];
        }
    };
});
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
client.on('ready', async (client) => {
//     //console.log(CommandsArray)
// clear all slash commands from global and guilds
    if (client.application.commands.cache.size > 0) {
        client.application.commands.set([])
    }
    guildIds.forEach(guild => {
        // check if client.guilds.cache.get(guild) is undefined
        if (client.guilds.cache.get(guild) && client.guilds.cache.get(guild).commands.cache.size > 0 ) {
            client.guilds.cache.get(guild).commands.set([])
        }
    })

    if (client.config.app.global) {
        client.application.commands.set(CommandsArray)
        console.log("Slash commands set globally!")
    }  else {
        guilds.forEach(guild => {
            client.guilds.cache.get(guild).commands.set(CommandsArray)
        })
        console.log("Slash commands set for guilds: " + guildIds.join(","))
    }
})