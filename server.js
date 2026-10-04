const express = require('express')
const http = require('http')
const path = require('path')
const { Server } = require('socket.io')

const app = express()
const server = http.createServer(app)
const io     = new Server(server)
const dashboardPort = Number.parseInt(process.env.PORT || process.env.DASHBOARD_PORT || '3000', 10)

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// Forward bot-engine logs to connected dashboards before loading the engine.
const log = console.log.bind(console)
const warn = console.warn.bind(console)
console.log = (...args) => {
  log(...args)
  io.emit('log', args.join(' '))
}
console.warn = (...args) => {
  warn(...args)
  io.emit('log', `⚠ ${args.join(' ')}`)
}

const { bots, handleCommand, BOT_COUNT, getServerConfig, setServerConfig } = require('./index')

let SERVER_CONFIG = getServerConfig()

function getBotStatuses() {
  const roundIfFinite = value => Number.isFinite(value) ? Math.round(value) : null

  return bots.filter(Boolean).map(bot => ({
    username: bot?.username || 'Unknown bot',
    online: Boolean(bot?.entity),
    state: bot?._connectionState || (bot?.entity ? 'online' : 'offline'),
    health: roundIfFinite(bot?.health),
    food: roundIfFinite(bot?.food),
    position: bot?.entity?.position ? {
      x: roundIfFinite(bot.entity.position.x),
      y: roundIfFinite(bot.entity.position.y),
      z: roundIfFinite(bot.entity.position.z),
    } : null,
  }))
}

function dispatchCommand(payload) {
  const value = typeof payload === 'string' ? payload : payload?.command
  const targetUsername = typeof payload === 'object' && payload !== null
    ? payload.username
    : null

  if (typeof value !== 'string' || !value.trim()) {
    return { status: 400, body: { ok: false, message: 'Command must be a non-empty string' } }
  }

  const command = value.trim()
  const targetBot = targetUsername
    ? bots.find(bot => bot?.username === targetUsername)
    : null
  if (targetUsername && !targetBot) {
    return { status: 404, body: { ok: false, message: `Bot not found: ${targetUsername}` } }
  }

  const activeBots = targetUsername
    ? targetBot?.entity ? [targetBot] : []
    : bots.filter(bot => bot?.entity)
  if (activeBots.length === 0) {
    const message = targetUsername ? `${targetUsername} is not online` : 'No bots online'
    return { status: 503, body: { ok: false, message } }
  }

  let sent = 0
  let failed = 0
  const errors = []
  for (const bot of activeBots) {
    try {
      handleCommand(bot, bot.username, command)
      sent++
    } catch (error) {
      failed++
      const message = error instanceof Error ? error.message : String(error)
      errors.push({ username: bot.username, message })
      console.warn(`[dashboard] command failed for ${bot.username}: ${message}`)
    }
  }

  const targetLabel = targetUsername || 'all online bots'
  io.emit('log', `[DASHBOARD] → ${command} (${targetLabel}, ${sent}/${activeBots.length})`)
  const ok = failed === 0
  return {
    status: ok ? 200 : sent > 0 ? 207 : 500,
    body: { ok, sent, failed, ...(errors.length ? { errors } : {}) },
  }
}

app.get('/api/bots', (_req, res) => res.json(getBotStatuses()))
app.get('/api/config', (_req, res) => {
  SERVER_CONFIG = getServerConfig()
  res.json({ server: SERVER_CONFIG, botCount: BOT_COUNT })
})

app.post('/api/config', (req, res) => {
  const { host, port, version } = req.body || {}
  const hasAnyValue = [host, port, version].some(value => String(value ?? '').trim() !== '')

  if (!hasAnyValue) {
    SERVER_CONFIG = setServerConfig({ host: '', port: 0, version: '' })
    io.emit('config', { server: SERVER_CONFIG, botCount: BOT_COUNT })
    return res.json({ ok: true, server: SERVER_CONFIG, botCount: BOT_COUNT })
  }

  if (!String(host ?? '').trim()) {
    return res.status(400).json({ ok: false, message: 'Server IP/hostname is required.' })
  }

  SERVER_CONFIG = setServerConfig({ host, port, version })
  io.emit('config', { server: SERVER_CONFIG, botCount: BOT_COUNT })

  for (const bot of bots.filter(Boolean)) {
    if (!bot || !bot.entity) continue
    try {
      bot.quit('server settings changed')
    } catch (error) {
      console.warn('[dashboard] failed to reconnect bot after config change:', error.message)
    }
  }

  return res.json({ ok: true, server: SERVER_CONFIG, botCount: BOT_COUNT })
})

app.post('/api/command', (req, res) => {
  const result = dispatchCommand(req.body)
  res.status(result.status).json(result.body)
})

io.on('connection', socket => {
  log('[dashboard] browser connected')
  socket.emit('config', { server: SERVER_CONFIG, botCount: BOT_COUNT })
  socket.emit('status', getBotStatuses())

  socket.on('command', payload => {
    const result = dispatchCommand(payload)
    socket.emit('command-result', result.body)
  })

  socket.on('disconnect', () => log('[dashboard] browser disconnected'))
})

setInterval(() => io.emit('status', getBotStatuses()), 2000)

server.listen(dashboardPort, '0.0.0.0', () => {
  log(`[dashboard] listening on ${dashboardPort} | Minecraft: ${SERVER_CONFIG.host || 'not configured'}:${SERVER_CONFIG.port}`)
})
