let reactions = ['✅', '❎', '❓']
const { checkGuild, log } = require('../../utilities.js')
const puppeteer = require('puppeteer')
const path = require('path')
const twit = require('twit')({
  consumer_key: 'dNRsXzACONSW07UdJQ7Pjdkc6',
  consumer_secret: 'KD0SDdbzb7OrYNCgjJfUWo66dpSgLd8WCrn4fffaPYwo0wig6d',
  access_token: '858864621893058560-KImtTaWcQDMPkhKE6diK6QUQJOIeCt9',
  access_token_secret: 'pBkS7T83E4924krvkigXcHvk2dvitbCq6f2l6BzyDCeOH'
})
const { MessageEmbed } = require('discord.js')
const PQueue = require('p-queue')

const queue = new PQueue({ concurrency: 1 })

let browser

module.exports = {
  reqs (client, db) {
    return new Promise((resolve, reject) => {
      db.prepare('CREATE TABLE IF NOT EXISTS twitter (id TEXT, guild TEXT, channel TEXT, auto TEXT DEFAULT "false", PRIMARY KEY (id,guild))').run()
      db.prepare('CREATE TABLE IF NOT EXISTS processed (name TEXT, tweet TEXT, PRIMARY KEY (name))').run()
      db.prepare(
        'CREATE TABLE IF NOT EXISTS tweets (id TEXT, url TEXT, guild TEXT, channel TEXT, PRIMARY KEY (id))'
      ).run()
      resolve()
    })
  },
  events: {
    async ready (client, db, moduleName) {
      run()

      async function changeTimeout () {
        try {
          let data = await twit.get('application/rate_limit_status', { resources: 'statuses' })
          let { limit } = data.data.resources.statuses['/statuses/user_timeline']
          let { length } = db.prepare('SELECT id FROM twitter GROUP BY id').all()

          console.log(`Next cycle on ${900000 / limit * length}`)
          setTimeout(run, 900000 / limit * length)
        } catch (err) { console.log(err) }
      }

      function run () {
        console.log('Running twitter cycle')
        let stmt = db.prepare('SELECT id,auto FROM twitter GROUP BY id')

        for (const row of stmt.iterate()) {
          let promise
          let proc = db.prepare('SELECT tweet FROM processed WHERE name = ?').get(row.id)

          if (proc) promise = twit.get('statuses/user_timeline', { screen_name: row.id, since_id: proc.tweet })
          else promise = twit.get('statuses/user_timeline', { screen_name: row.id, count: 5 })
          promise.then(res => {
            let { data } = res
            if (data[0]) {
              db.prepare('INSERT OR IGNORE INTO processed(name,tweet) VALUES(?,?)').run(data[0].user.screen_name, data[0].id_str)
              db.prepare('UPDATE processed SET tweet = ? WHERE name = ?').run(data[0].id_str, data[0].user.screen_name)
            }
            console.log(`${row.id}: ${data.length} tweets`)
            data.forEach(tweet => {
              queue.add(() => screenshotTweet(client, tweet.id_str)).then(shotBuffer => {
                let out = {}

                let embed = new MessageEmbed()
                  .setAuthor(`${tweet.user.name} | ${tweet.user.screen_name}`, tweet.user.profile_image_url)
                  .setThumbnail()
                  .setColor(tweet.user.profile_background_color)
                  .setTimestamp()

                let url = `https://twitter.com/${tweet.user.screen_name}/status/${tweet.id_str}/`

                embed.addField('URL', url)
                embed.addField('Channel', 'Test channel')
                embed.attachFiles([{ name: 'imageTweet.png', attachment: shotBuffer }])
                  .setImage('attachment://imageTweet.png')

                let stmt2 = db.prepare('SELECT channel,guild,auto FROM twitter WHERE id=?')
                out.embed = embed

                for (const row2 of stmt2.iterate(row.id)) {
                  if (!checkGuild(db, client.guilds.get(row2.guild), moduleName)) continue
                  embed.fields[1].value = `#${client.guilds.get(row2.guild).channels.find(c => c.name === row2.channel).name}`

                  if (row2.auto === 'true') {
                    embed.setFooter(`Accepted by the power of nanomachines`)

                    client.guilds.get(row2.guild).channels.find(c => c.name === row2.channel).send({ content: `<${url}>`, files: [`temp/${url.split('/').slice(-2)[0]}.png`] })

                    embed.setTimestamp()
                    client.guilds.get(row2.guild).channels.find(c => c.name === 'tweet-approval-log').send(embed)
                  } else {
                    client.guilds.get(row2.guild).channels.find(c => c.name === 'tweet-approval').send(out).then(m => {
                      m.react('✅').then(() => {
                        m.react('❎').then(() => {
                          m.react('❓').then(() => {
                            db.prepare('INSERT INTO tweets (id,url,channel,guild) VALUES (?,?,?,?)').run(m.id, url, row2.channel, m.guild.id)
                          })
                        })
                      })
                    })
                  }
                }
              })
            })
          })
        }
        changeTimeout()
      }
    },

    async messageReactionAdd (client, db, moduleName, reaction, user) {
      if (reaction.message.partial) await reaction.message.fetch()
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
                return reaction.message.guild.channels.find(c => c.name === row.channel)
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
                  .get(reaction.message.id, reaction.message.guild.id).url
                channel.send({ content: `<${url}>`, files: [`temp/${url.split('/').slice(-2)[0]}.png`] }).catch(err => {
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

function screenshotTweet (client, id) {
  return new Promise(async (resolve, reject) => {
    if (!browser) browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] })
    const page = await browser.newPage()
    page.setViewport({ width: 1000, height: 600, deviceScaleFactor: 5 })

    page.goto(path.join('file://', __dirname, `index.html?id=${id}`)).catch(err => {
      log(client, path.join('file://', __dirname, `index.html?id=${id}`))
      log(client, err.stack)
    })
    setTimeout(async () => {
      const rect = await page.evaluate(() => {
        const element = document.querySelector('#container')
        const { x, y, width, height } = element.getBoundingClientRect()
        return { left: x, top: y, width, height, id: element.id }
      })

      let buffer = await page.screenshot({
        path: `temp/${id}.png`,
        clip: {
          quality: 85,
          x: rect.left,
          y: rect.top,
          width: 550,
          height: rect.height
        }
      })
      await page.close()
      resolve(buffer)
    }, 30 * 1000)
  })
}
