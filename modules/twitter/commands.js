const twit = require('twit')({
  consumer_key: 'dNRsXzACONSW07UdJQ7Pjdkc6',
  consumer_secret: 'KD0SDdbzb7OrYNCgjJfUWo66dpSgLd8WCrn4fffaPYwo0wig6d',
  access_token: '858864621893058560-KImtTaWcQDMPkhKE6diK6QUQJOIeCt9',
  access_token_secret: 'pBkS7T83E4924krvkigXcHvk2dvitbCq6f2l6BzyDCeOH'
})
const { log } = require('../../utilities.js')

module.exports = {
  commands: {
    twitteradd: {
      desc: 'Adds a twitter account to a designated channel for automatic posting\nAdd "auto" at the end for automatic posting.',
      usage: 'twitteradd [username] [channel] auto',
      async execute (client, msg, param, db, moduleName) {
        if (!param[2]) {
          return msg.channel.send('Usage: twitteradd username channel [auto]')
        }
        let username = param[1]
        let channel = param[2]
        let auto = param[3] && param[3].toLowerCase() === 'auto' ? 'true' : 'false'

        if (msg.mentions.channels.size > 0) {
          channel = msg.mentions.channels.first().name
        }
        if (!msg.guild.channels.find(c => c.name === channel)) {
          return msg.channel.send('Channel doesnt exist')
        }

        twit
          .get('users/show', { screen_name: username })
          .then(res => {
            db.prepare('INSERT INTO twitter (id,channel,guild,auto) VALUES (?,?,?,?)').run(
              res.data.screen_name,
              channel,
              msg.guild.id,
              auto
            )
            msg.channel.send('Account added!')
          })
          .catch(err => {
            console.log(err)
            if (err.code === 50) return msg.channel.send('User not found')
            log(client, err.message || err.stack)
            msg.channel.send('Something went wrong!')
          })
      }
    },

    twitterremove: {
      desc: 'Removes a twitter account from automatic posting.',
      usage: 'twitterremove [username]',
      async execute (client, msg, param, db) {
        if (!param[2]) {
          return msg.channel.send('Usage: twitterremove username')
        }
        let username = param[1]
        if (db.prepare('SELECT id FROM twitter WHERE id = ? AND guild=?').get(
          username,
          msg.guild.id
        )) {
          db.prepare('DELETE FROM twitter WHERE id = ? AND guild=?').run(
            username,
            msg.guild.id
          )
          msg.channel.send('Account removed!')
        } else msg.channel.send('User not found')
      }
    },

    twitterclear: {
      desc: 'Rejects all tweets waiting for approval',
      async execute (client, msg, param, db) {
        await msg.channel.send(
          `${
            msg.author
          } Are you sure you want to reject all current tweets? Write "yes" to continue`
        )
        const filter = m => m.author.id === msg.author.id
        msg.channel.awaitMessages(filter, { max: 1 }).then(async collected => {
          try {
            let m = collected.first()
            if (m.content.toLowerCase() === 'yes') {
              let purge = await m.channel.send('Starting purge')
              let channel1 = m.guild.channels.find(
                c => c.name === 'tweet-approval'
              )
              let channel2 = await channel1.clone()
              await channel1.delete()

              db.prepare('DELETE FROM tweets WHERE guild=?').run(m.guild.id)
              purge.edit('Purge complete')

              let position = m.guild.channels.find(c => c.name === 'tweet-approval-log').rawPosition

              await channel2.edit({
                position: position
              })
              m.guild.channels
                .find(c => c.name === 'tweet-approval-log')
                .send(`#tweet-approval cleared by ${msg.author}`)
            } else {
              msg.channel.send('Purge stopped')
            }
          } catch (err) {
            console.log(err)
            msg.channel.send('Something went wrong')
          }
        })
      }
    },
    twitterpost: {
      desc: 'Posts the given tweet on a channel.',
      usage: 'twitterpost [channel] [url]',
      async execute (client, msg, param, db) {
        /* if (!param[2]) {
          return msg.channel.send('Usage: >twitterpost [channel] [url]')
        }
        let channel = param[1]
        let url = param[2]

        if (msg.mentions.channels.size > 0) {
          channel = msg.mentions.channels.first()
        } else if (!msg.guild.channels.some(c => c.name === channel)) {
          return msg.channel.send('Channel doesnt exist')
        } else {
          channel = msg.guild.channels.find(c => c.name === channel).first()
        }

        let id = url.split('/').filter(e => e !== '').slice(-1)[0].split('?')[0]
        let queueMsg = await msg.channel.send(`Processing your request.... ${queue.size > 0 ? `Queue: ${queue.size}` : 'right now!'} `)
        queue.add(() => screenshotTweet(client, id)).then(async shotBuffer => {
          await channel.send({ content: `<${url}>`, files: [shotBuffer] })
          queueMsg.edit('Tweet processed!')
        }) */
      }
    }
  }
}
