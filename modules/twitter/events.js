let { stream } = require('./util.js')
let reactions = ['✅', '❎', '❓']
const { checkGuild } = require('../../utilities.js')

module.exports = {
  reqs (client, db) {
    return new Promise((resolve, reject) => {
      db.prepare(
        'CREATE TABLE IF NOT EXISTS twitter (id TEXT, guild TEXT, channel TEXT, PRIMARY KEY (id,channel,guild))'
      ).run()
      db.prepare(
        'CREATE TABLE IF NOT EXISTS tweets (id TEXT, url TEXT, guild TEXT, channel TEXT, PRIMARY KEY (id))'
      ).run()
      resolve()
    })
  },
  events: {
    async ready (client, db, moduleName) {
      let ids = db
        .prepare('SELECT id FROM twitter')
        .all()
        .map(r => r.id)

      if (ids.length > 0) stream(client, db, moduleName, ids)

      let guilds = db.prepare('SELECT guild FROM twitter GROUP BY guild').all()
      let tasks = guilds.map(row => new Promise(async (resolve, reject) => {
        if (!checkGuild(db, client.guilds.get(row.guild), moduleName)) return resolve()

        let tweetChannel = client.guilds.get(row.guild).channels.find(c => c.name === 'tweet-approval')
        await tweetChannel.send('Twitter service is up!')
        await tweetChannel.messages.fetch()
        resolve()
      }))

      await Promise.all(tasks)
    },

    async messageReactionAdd (client, db, moduleName, reaction, user) {
      if (
        reaction.message.channel.name === 'tweet-approval' &&
        !user.bot &&
        reactions.includes(reaction.emoji.name) &&
        checkGuild(db, reaction.message.guild, moduleName)
      ) {
        let embed = reaction.message.embeds[0]

        switch (reaction.emoji.name) {
          case '✅':
            embed.setFooter(`Accepted by ${user}`)
            let url = ''
            let msgs = db
              .prepare('SELECT channel,url FROM tweets WHERE id=? AND guild=?')
              .all(reaction.message.id, reaction.message.guild.id)
              .map(row => {
                return reaction.message.guild.channels.get(row.channel)
                  .send({ content: `<${row.url}>`, files: [`temp/${row.url.split('/').slice(-2)[0]}.png`] })
              })

            Promise.all(msgs).catch(err => {
              console.log(err)
              reaction.message.guild.channels
                .find(c => c.name === 'tweet-approval-log')
                .send(`A message couldnt be send in some channels. URL: ${url}`)
            })

            sendLog(client, db, reaction, embed, 'tweet-approval-log')
            break

          case '❎':
            embed.setFooter(`Rejected by ${user}`)
            sendLog(client, db, reaction, embed, 'tweet-approval-log')
            break

          case '❓':
            let question = await reaction.message.channel.send(
              `${user} type (or mention) the name of the channel where you want to send the tweet.`
            )
            const filter = m =>
              m.mentions.channels.size > 0 ||
              reaction.message.guild.channels.some(c => c.name === m.content)
            reaction.message.channel
              .awaitMessages(filter, { max: 1 })
              .then(collected => {
                let channel
                if (collected.first().mentions.channels.size > 0) { channel = collected.first().mentions.channels.first() } else {
                  channel = reaction.message.guild.channels.find(
                    c => c.name === collected.first().content
                  )
                }

                embed.setFooter(`Accepted by ${user}`)

                let url = db
                  .prepare('SELECT channel,url FROM tweets WHERE id=? AND guild=?')
                  .all(reaction.message.id, reaction.message.guild.id)[0].url
                channel.send(url).catch(err => {
                  console.log(err)
                  reaction.message.guild.channels
                    .find(c => c.name === 'tweet-approval-log')
                    .send(
                      `A message couldnt be send in some channels. URL: ${url}`
                    )
                })

                sendLog(client, db, reaction, embed, 'tweet-approval-log')
                question.delete()
                collected.first().delete()
              })
            break
        }
      }
    }
  }
}

function sendLog (client, db, reaction, embed, channelName) {
  db.prepare('DELETE FROM tweets WHERE id=? AND guild=?').run(reaction.message.id, reaction.message.guild.id)

  embed.setTimestamp()
  reaction.message.guild.channels.find(c => c.name === channelName).send(embed)
  reaction.message.delete()
}
