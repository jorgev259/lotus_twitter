
const Twitter = require('twit')({
  consumer_key: 'dNRsXzACONSW07UdJQ7Pjdkc6',
  consumer_secret: 'KD0SDdbzb7OrYNCgjJfUWo66dpSgLd8WCrn4fffaPYwo0wig6d',
  access_token: '858864621893058560-KImtTaWcQDMPkhKE6diK6QUQJOIeCt9',
  access_token_secret: 'pBkS7T83E4924krvkigXcHvk2dvitbCq6f2l6BzyDCeOH'
})

const puppeteer = require('puppeteer')
const path = require('path')
// const fs = require('fs')
const PQueue = require('p-queue')

const queue = new PQueue({ concurrency: 1 })

let streams = {}
const { log, checkGuild } = require('../../utilities.js')
const { MessageEmbed } = require('discord.js')
// const { loadImage, createCanvas } = require('canvas')

let browser

module.exports = {
  streams: streams,
  twitter: Twitter,
  queue: queue,
  screenshotTweet: screenshotTweet,
  stream (client, db, moduleName, ids) {
    if (Object.keys(streams).some(r => ids.includes(r))) return
    var stream = Twitter.stream('statuses/filter', { follow: ids })
    ids.forEach(id => { streams[id] = stream })

    stream.on('tweet', async function (tweet) {
      if (Object.keys(streams).includes(tweet.user.id_str)) {
        queue.add(() => screenshotTweet(client, tweet.id_str)).then(async shotBuffer => {
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

          /* if (tweet.extended_entities && tweet.extended_entities.media) {
            let media = tweet.extended_entities.media.filter(e => e.type === 'photo').map(e => loadImage(e.media_url))
            if (media.length > 1) {
              let array = await Promise.all(media)

              let widthTotal = 0
              let x = 0

              array.sort((a, b) => {
                return a.height > b.height ? -1 : b.height > a.height ? 1 : 0
              })

              array.forEach(e => { widthTotal += e.width })
              if (array[0] !== undefined) {
                let canvas = createCanvas(widthTotal, array[0].height)
                let ctx = canvas.getContext('2d')

                array.forEach(e => {
                  ctx.drawImage(e, x, 0)
                  x += e.width
                })

                let buf = canvas.toBuffer()
                fs.writeFileSync(`media_temp/${tweet.id_str}.png`, buf)
                out.files = [{ attachment: buf, name: 'images.png' }]
              }
            }
          } */

          let stmt = db.prepare('SELECT channel,guild FROM twitter WHERE id=?')
          out.embed = embed

          for (const row of stmt.iterate(tweet.user.id_str)) {
            if (!checkGuild(db, client.guilds.get(row.guild), moduleName)) continue

            embed.fields[1].value = `#${client.guilds.get(row.guild).channels.get(row.channel).name}`

            client.guilds.get(row.guild).channels.find(c => c.name === 'tweet-approval').send(out).then(m => {
              m.react('✅').then(() => {
                m.react('❎').then(() => {
                  m.react('❓').then(() => {
                    db.prepare('INSERT INTO tweets (id,url,channel,guild) VALUES (?,?,?,?)').run(m.id, url, row.channel, m.guild.id)
                  })
                })
              })
            })
          }
        })
      }
    })
    stream.on('error', function (err) {
      log(client, err.message)
    })
  },
  remove (id) {
    delete streams[id]
  }
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
