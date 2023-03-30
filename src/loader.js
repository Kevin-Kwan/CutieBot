const { readdirSync } = require('fs');
const { Collection } = require('discord.js');

client.slashcommands = new Collection();
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
            console.log(`-> [Loaded Command] ${command.data.name.toLowerCase()}`);
            delete require.cache[require.resolve(`../src/slash-commands/${dirs}/${file}`)];
        }
    };
});

client.on('ready', (client) => {
 if (client.config.app.global) {
    client.application.commands.set(CommandsArray)
    console.log("Slash commands set globally!")
}  else {
    client.guilds.cache.get(client.config.app.guild).commands.set(CommandsArray)
  }
})