require('dotenv').config();
module.exports = {
    app: {
        token: process.env.DISCORD_TOKEN,
        playing: 'XXX',
        global: false,
        guild: process.env.GUILD_ID,
        ChatGPTJailbreak: false,
    },
    opt: {
        DJ: {
            enabled: false,
            roleName: 'XXX',
            commands: []
        },
        maxVol: 100,
        leaveOnEnd: true,
        leaveOnEmpty: true,
        loopMessage: false,
        spotifyBridge: true,
        defaultvolume: 75,
        discordPlayer: {
            ytdlOptions: {
                quality: 'highestaudio',
                highWaterMark: 1 << 25
            }
        }
    }
};