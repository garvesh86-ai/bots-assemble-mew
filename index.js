const mineflayer  = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { GoalNear, GoalFollow } = goals
const pvp          = require('mineflayer-pvp').plugin
const fs           = require('fs')
const readline     = require('readline')
const { Vec3 }     = require('vec3')
const path         = require('path')

// ─── CONFIG ────────────────────────────────────────────────────────────────
// Pass values in code or via environment variables, e.g.:
//   MC_HOST=play.gofl-host.in MC_PORT=25575 MC_VERSION=1.21.11 node server.js
// Keep the protocol version as a valid Minecraft version string. Labels like "26.2"
// are often server-side ViaVersion compatibility labels, not Mineflayer protocol versions.
const HOST = (process.env.MC_HOST || '').trim()
const PORT = Number(process.env.MC_PORT || 25575)
const VERSION = (process.env.MC_VERSION || '1.21.11').trim()
const OWNER = process.env.OWNER || 'MEW_SAN'
const BOT_COUNT = Number(process.env.BOT_COUNT || 1)
const BOT_PREFIX = (process.env.BOT_PREFIX || 'mew_bot').trim() || 'mew_bot'
const JOIN_DELAY = Number(process.env.JOIN_DELAY || 20000)
const RECONNECT_DELAY = Number(process.env.RECONNECT_DELAY || 15000)

let runtimeServerConfig = {
  host: HOST,
  port: PORT,
  version: VERSION,
}
let botArmyStarted = false
let botArmyTimers = []

function getServerConfig() {
  return { ...runtimeServerConfig }
}

function isServerConfigured() {
  const host = String(runtimeServerConfig.host || '').trim()
  const port = Number(runtimeServerConfig.port)
  return Boolean(host) && Number.isFinite(port) && port > 0
}

function setServerConfig(nextConfig = {}) {
  const rawHost = nextConfig.host ?? runtimeServerConfig.host ?? HOST
  const host = String(rawHost).trim()
  const portValue = nextConfig.port ?? runtimeServerConfig.port ?? PORT
  const port = Number.isFinite(Number(portValue)) ? Number(portValue) : (host ? PORT : 0)
  const versionValue = nextConfig.version ?? runtimeServerConfig.version ?? VERSION
  const version = String(versionValue).trim() || VERSION

  runtimeServerConfig = { host, port: host ? port : 0, version: host ? version : '' }

  if (!host) {
    console.log('[army] neutral mode: waiting for a server IP in the dashboard')
    for (const bot of bots.filter(Boolean)) {
      try { bot.quit('server config cleared') } catch {}
    }
    while (bots.length) bots.pop()
    botArmyStarted = false
    return { ...runtimeServerConfig }
  }

  if (!botArmyStarted) {
    startBotArmy()
  }

  return { ...runtimeServerConfig }
}

function startBotArmy() {
  if (botArmyStarted || !isServerConfigured()) {
    if (!isServerConfigured()) {
      console.log('[army] neutral mode: no server configured yet')
    }
    return
  }

  botArmyStarted = true
  botArmyTimers.forEach(timer => clearTimeout(timer))
  botArmyTimers = []

  for (let i = 1; i <= BOT_COUNT; i++) {
    const delay = (i - 1) * JOIN_DELAY + Math.floor(Math.random() * 3000)
    const timer = setTimeout(() => createBot(i), delay)
    botArmyTimers.push(timer)
  }
}

const USE_TOKENS = false
const TOKENS = []

// ─── PERSISTENCE ──────────────────────────────────────────────────────────
const REGISTERED_FILE = path.join(__dirname, 'registered.json')
function loadRegistered() {
  try { return JSON.parse(fs.readFileSync(REGISTERED_FILE, 'utf8')) } catch { return {} }
}
function saveRegistered(data) {
  fs.writeFileSync(REGISTERED_FILE, JSON.stringify(data, null, 2))
}
const registeredBots = loadRegistered()

// ─── USERNAME GENERATOR ───────────────────────────────────────────────────
function randName() {
  const adj  = ['Dark','Pro','Shadow','Ninja','Hyper','Void','Storm','Blaze','Swift','Ghost']
  const noun = ['Gamer','Plays','YT','OP','XD','GG','Boy','King','Wolf','Fox']
  const num  = Math.floor(Math.random() * 9000) + 1000
  return adj[Math.floor(Math.random() * adj.length)] + noun[Math.floor(Math.random() * noun.length)] + num
}

const BOT_NAMES = USE_TOKENS
  ? TOKENS.map(t => t.username)
  : Array.from({ length: BOT_COUNT }, (_, index) =>
    index === 0 ? (process.env.BOT_USERNAME || `${BOT_PREFIX}2`).trim() : `${BOT_PREFIX}${index + 2}`
  )

// ─── ARMOR PRIORITY ───────────────────────────────────────────────────────
const ARMOR_ORDER = ['netherite','diamond','golden','iron','chainmail','leather']
function armorScore(itemName) {
  if (!itemName) return -1
  for (let i = 0; i < ARMOR_ORDER.length; i++) {
    if (itemName.includes(ARMOR_ORDER[i])) return ARMOR_ORDER.length - i
  }
  return 0
}

// ─── WEAPON PRIORITY ──────────────────────────────────────────────────────
const WEAPON_ORDER = ['netherite_sword','diamond_sword','golden_sword','iron_sword','stone_sword','wooden_sword','netherite_axe','diamond_axe','golden_axe','iron_axe','stone_axe','wooden_axe']
const HOSTILE_MOBS = new Set([
  'blaze', 'bogged', 'breeze', 'cave_spider', 'creeper', 'drowned', 'elder_guardian',
  'enderman', 'endermite', 'evoker', 'ghast', 'guardian', 'hoglin', 'husk', 'magma_cube',
  'phantom', 'piglin_brute', 'pillager', 'ravager', 'shulker', 'silverfish', 'skeleton',
  'slime', 'spider', 'stray', 'vex', 'vindicator', 'warden', 'witch', 'wither_skeleton',
  'zoglin', 'zombie', 'zombie_villager', 'zombified_piglin',
])

function isHostileMob(entity) {
  const name = String(entity?.name || '').split(':').pop().toLowerCase()
  return entity?.type === 'hostile' || (entity?.type === 'mob' && HOSTILE_MOBS.has(name))
}

function weaponScore(itemName) {
  if (!itemName) return -1
  const idx = WEAPON_ORDER.indexOf(itemName)
  return idx === -1 ? -1 : WEAPON_ORDER.length - idx
}

const BRIDGE_BLOCKS = new Set(['cobblestone', 'stone', 'dirt', 'oak_planks', 'netherrack', 'sand', 'gravel'])

function pickBridgeBlock(bot) {
  const item = bot.inventory.items()
    .filter(i => BRIDGE_BLOCKS.has(i.name))
    .sort((a, b) => (b.count || 1) - (a.count || 1))[0]
  return item || null
}

async function tryBridgeToTarget(bot, target) {
  if (!bot || !bot.entity || !target || !target.position) return false
  if (bot.pathfinder && bot.pathfinder.isMoving()) return false

  const botPos = bot.entity.position
  const targetPos = target.position
  const heightGap = targetPos.y - botPos.y
  if (heightGap <= 1.2) return false

  const bridgeBlock = pickBridgeBlock(bot)
  if (!bridgeBlock) return false

  const originX = Math.floor(botPos.x)
  const originY = Math.floor(botPos.y)
  const originZ = Math.floor(botPos.z)
  const dx = Math.sign(Math.round(targetPos.x - botPos.x) || 1)
  const dz = Math.sign(Math.round(targetPos.z - botPos.z) || 1)

  const candidatePositions = [
    { x: originX, y: originY + 1, z: originZ },
    { x: originX + dx, y: originY + 1, z: originZ },
    { x: originX, y: originY + 1, z: originZ + dz },
    { x: originX + dx, y: originY + 1, z: originZ + dz },
    { x: originX, y: originY + 2, z: originZ },
  ]

  for (const pos of candidatePositions) {
    const current = bot.blockAt(new Vec3(pos.x, pos.y, pos.z))
    if (current && current.type !== 0) continue

    const support = bot.blockAt(new Vec3(pos.x, pos.y - 1, pos.z))
    if (!support || support.type === 0) continue

    try {
      const item = bot.inventory.items().find(i => i.name === bridgeBlock.name)
      if (!item) continue
      bot.lookAt(targetPos.offset(0, 1.62, 0), true)
      await bot.placeBlock(support, new Vec3(0, 1, 0))
      console.log(`[${bot.username}] bridged upward to keep up with owner`)
      return true
    } catch (err) {
      // try next candidate if placement fails
    }
  }

  return false
}

// ─── IDLE MOVEMENT ────────────────────────────────────────────────────────
function startIdleMovement(bot) {
  function scheduleIdle() {
    setTimeout(() => {
      if (!bot.entity) return
      if (bot.pathfinder.isMoving()) { scheduleIdle(); return }
      Math.random() < 0.6
        ? bot.look((Math.random()*Math.PI*2)-Math.PI, (Math.random()*0.4)-0.2, false)
        : bot.swingArm()
      scheduleIdle()
    }, 20000 + Math.random() * 15000)
  }
  scheduleIdle()
}

// ─────────────────────────────────────────────────────────────────────────
const bots = []
const followingBotSlots = new Set()

function getReconnectDelay(reasonText = '') {
  const text = String(reasonText || '').toLowerCase()
  if (text.includes('server is starting') || text.includes('please wait') || text.includes('requesting slot')) return 5000
  if (text.includes('socketclosed') || text.includes('timeout') || text.includes('disconnected')) return 10000
  return RECONNECT_DELAY
}

function requiresFabricMods(reasonText = '') {
  const text = String(reasonText || '').toLowerCase()
  return text.includes('requires fabric loader') || text.includes('fabric api installed on your client')
}

function normalizePlayerName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function playerNameMatches(actualName, requestedName) {
  const actual = normalizePlayerName(actualName)
  const requested = normalizePlayerName(requestedName)
  return Boolean(actual && requested && (actual === requested || actual.includes(requested) || requested.includes(actual)))
}

function findNamedPlayerEntity(bot, requestedName) {
  const candidates = [...new Set([
    ...Object.values(bot.players || {}).map(player => player?.entity),
    ...Object.values(bot.entities || {}),
  ].filter(entity => entity?.type === 'player' && entity.username))]
  const exact = candidates.find(entity => normalizePlayerName(entity.username) === normalizePlayerName(requestedName))
  if (exact) return exact
  const matches = candidates.filter(entity => playerNameMatches(entity.username, requestedName))
  return matches.length === 1 ? matches[0] : null
}

async function createBot(index) {
  const username = BOT_NAMES[index - 1] || randName()
  const { host: connectionHost, port: connectionPort, version: connectionVersion } = getServerConfig()

  let botOptions = { host: connectionHost, port: connectionPort, version: connectionVersion, auth: 'offline', username }

  if (USE_TOKENS && TOKENS[index - 1]) {
    const t = TOKENS[index - 1]
    botOptions.auth     = 'microsoft'
    botOptions.username = t.username
    botOptions.session  = {
      accessToken:     t.token,
      selectedProfile: { name: t.username, id: t.uuid.replace(/-/g,'') },
      clientToken:     require('crypto').randomUUID().replace(/-/g,'')
    }
  }

  console.log(`[${username}] connecting…`)
  const bot = mineflayer.createBot(botOptions)
  bot.username = username
  bot._connectionState = 'connecting'
  bot.loadPlugin(pathfinder)
  bot.loadPlugin(pvp)

  const password = username
  let registered = false
  let loggedIn   = false
  let lastHealth = 20
  let fighting   = false
  let lastPreFightAppleAt = 0
  let followingOwner = followingBotSlots.has(index)
  let followTargetEntity = null
  let followMonitor = null
  let stuckMonitor = null
  let idleMonitor = null
  let lastActivityPosition = null
  let lastActivityAt = Date.now()
  let idleCrouching = false

  function maintainOwnerFollow() {
    if (!followingOwner || fighting || !bot.entity) return

    const target = findNamedPlayerEntity(bot, OWNER)
    if (!target) {
      if (followTargetEntity) {
        followTargetEntity = null
        bot.pathfinder.setGoal(null)
      }
      return
    }

    const heightGap = target.position.y - bot.entity.position.y
    if (heightGap > 1.2) {
      tryBridgeToTarget(bot, target)
    }

    if (target !== followTargetEntity || !bot.pathfinder.goal) {
      followTargetEntity = target
      bot.pathfinder.setGoal(new GoalFollow(target, 2), true)
    }
  }

  // ── Spawn ──────────────────────────────────────────────────────────────
  bot.once('spawn', () => {
    bot._connectionState = 'online'
    console.log(`[${username}] spawned`)
    const mcData    = require('minecraft-data')(bot.version)
    const movements = new Movements(bot, mcData)
    movements.allowSprinting = true
    movements.canDig = false
    bot.pathfinder.setMovements(movements)

    lastActivityPosition = bot.entity.position.clone()
    lastActivityAt = Date.now()
    if (!idleMonitor) idleMonitor = setInterval(() => {
      if (!bot.entity) return

      const position = bot.entity.position
      const isMoving = bot.pathfinder.isMoving()
        || position.distanceTo(lastActivityPosition) > 0.1
        || fighting

      if (isMoving) {
        lastActivityPosition = position.clone()
        lastActivityAt = Date.now()
        if (idleCrouching) {
          bot.setControlState('sneak', false)
          idleCrouching = false
        }
        return
      }

      if (Date.now() - lastActivityAt >= 120000 && !idleCrouching) {
        bot.setControlState('sneak', true)
        idleCrouching = true
        console.log(`[${username}] crouching after 2 minutes idle`)
      }
    }, 1000)

    if (!followMonitor) followMonitor = setInterval(() => {
      maintainOwnerFollow()
    }, 750)

    if (!stuckMonitor) {
      let lastProgressPosition = null
      let lastProgressAt = Date.now()
      let recoveryCooldownUntil = 0
      stuckMonitor = setInterval(() => {
        if (!bot.entity || (fighting && !pvpPathing) || !bot.pathfinder.goal || !bot.pathfinder.isMoving()) {
          lastProgressPosition = null
          lastProgressAt = Date.now()
          return
        }

        const position = bot.entity.position
        if (!lastProgressPosition || position.distanceTo(lastProgressPosition) > 0.35) {
          lastProgressPosition = position.clone()
          lastProgressAt = Date.now()
          return
        }

        const now = Date.now()
        if (now - lastProgressAt < 4000 || now < recoveryCooldownUntil) return
        recoveryCooldownUntil = now + 15000

        const goal = bot.pathfinder.goal
        const scaffoldItems = new Set(['dirt', 'cobblestone', 'stone', 'netherrack', 'oak_planks'])
        movements.scafoldingBlocks = bot.inventory.items()
          .filter(item => scaffoldItems.has(item.name))
          .map(item => item.type)
        movements.canDig = true
        bot.pathfinder.setMovements(movements)
        bot.pathfinder.setGoal(goal, true)
        bot.setControlState('jump', true)
        setTimeout(() => {
          bot.setControlState('jump', false)
          if (!bot.entity) return
          movements.canDig = false
          movements.scafoldingBlocks = []
          bot.pathfinder.setMovements(movements)
          if (bot.pathfinder.goal) bot.pathfinder.setGoal(bot.pathfinder.goal, true)
        }, 5000)
        console.log(`[${username}] path recovery: temporary digging/scaffolding enabled`)
      }, 1000)
    }
    startIdleMovement(bot)

    // Equip best gear shortly after spawn
    setTimeout(() => {
      autoEquip(bot)
      autoTotem(bot)
    }, 3000)
  })

  // ── Auto equip best armor + weapon ────────────────────────────────────
  async function autoEquip(bot) {
    try {
      const inv = bot.inventory.items()

      // Helmet
      const helmets = inv.filter(i => i.name.includes('helmet'))
      helmets.sort((a,b) => armorScore(b.name) - armorScore(a.name))
      const curHelmet = bot.inventory.slots[5]
      if (helmets.length && (!curHelmet || armorScore(helmets[0].name) > armorScore(curHelmet.name))) {
        await bot.equip(helmets[0], 'head').catch(()=>{})
      }

      // Chestplate
      const chests = inv.filter(i => i.name.includes('chestplate'))
      chests.sort((a,b) => armorScore(b.name) - armorScore(a.name))
      const curChest = bot.inventory.slots[6]
      if (chests.length && (!curChest || armorScore(chests[0].name) > armorScore(curChest.name))) {
        await bot.equip(chests[0], 'torso').catch(()=>{})
      }

      // Leggings
      const legs = inv.filter(i => i.name.includes('leggings'))
      legs.sort((a,b) => armorScore(b.name) - armorScore(a.name))
      const curLegs = bot.inventory.slots[7]
      if (legs.length && (!curLegs || armorScore(legs[0].name) > armorScore(curLegs.name))) {
        await bot.equip(legs[0], 'legs').catch(()=>{})
      }

      // Boots
      const boots = inv.filter(i => i.name.includes('boots'))
      boots.sort((a,b) => armorScore(b.name) - armorScore(a.name))
      const curBoots = bot.inventory.slots[8]
      if (boots.length && (!curBoots || armorScore(boots[0].name) > armorScore(curBoots.name))) {
        await bot.equip(boots[0], 'feet').catch(()=>{})
      }

      // Best weapon — always upgrade
      const weapons = inv.filter(i => weaponScore(i.name) > -1)
      weapons.sort((a,b) => weaponScore(b.name) - weaponScore(a.name))
      const curWeapon = bot.heldItem
      if (weapons.length && (!curWeapon || weaponScore(weapons[0].name) > weaponScore(curWeapon.name))) {
        await bot.equip(weapons[0], 'hand').catch(()=>{})
        console.log(`[${username}] equipped ${weapons[0].name}`)
      }
    } catch(e) {
      console.log(`[${username}] equip error: ${e.message}`)
    }
  }

  // ── Auto eat when hungry ───────────────────────────────────────────────
  async function autoEat(bot) {
    if (bot.food >= 18) return
    const foods = [
      'enchanted_golden_apple','golden_apple',
      'cooked_beef','cooked_porkchop','cooked_mutton','cooked_chicken',
      'cooked_salmon','cooked_cod','bread','carrot','apple',
      'baked_potato','pumpkin_pie','cookie','melon_slice'
    ]
    const inv = bot.inventory.items()
    for (const foodName of foods) {
      const food = inv.find(i => i.name === foodName)
      if (food) {
        try {
          lowerShield(bot)
          await bot.equip(food, 'hand')
          await bot.consume()
          console.log(`[${username}] ate ${foodName}`)
          setTimeout(() => autoEquip(bot), 500)
        } catch(e) {}
        return
      }
    }
  }

  // ── Smart survival: priority gapples, then healing potions ─────────────
  async function useBestHealingItem(bot, force = false) {
    const inv = bot.inventory.items()
    const healthPercent = (bot.health / 20) * 100

    const gappie = inv.find(i => ['enchanted_golden_apple', 'golden_apple'].includes(i.name))
    if (gappie && (force || healthPercent <= 60 || (bot.food < 10 && bot.health <= 14))) {
      try {
        lowerShield(bot)
        await bot.equip(gappie, 'hand')
        await bot.consume()
        console.log(`[${username}] used ${gappie.name} at ${Math.round(bot.health)} HP`)
        setTimeout(() => autoEquip(bot), 500)
        return true
      } catch (e) {}
    }

    const healingPotion = inv.find(i => {
      const name = (i.name || '').toLowerCase()
      const tag = (i.nbt?.value?.Potion?.value || '').toString().toLowerCase()
      return (name.includes('potion') || name.includes('splash_potion')) &&
        (tag.includes('healing') || tag.includes('regeneration') || tag.includes('instant_health'))
    })

    if (healingPotion && (force || healthPercent <= 40 || bot.health <= 10)) {
      try {
        lowerShield(bot)
        await bot.equip(healingPotion, 'hand')
        await bot.consume()
        console.log(`[${username}] drank healing potion at ${Math.round(bot.health)} HP`)
        setTimeout(() => autoEquip(bot), 500)
        return true
      } catch (e) {}
    }

    return false
  }

  async function eatGoldenAppleBeforeFight(bot) {
    if (Date.now() - lastPreFightAppleAt < 45000) return false
    const inventory = bot.inventory.items()
    const apple = inventory.find(item => item.name === 'enchanted_golden_apple')
      || inventory.find(item => item.name === 'golden_apple')
    if (!apple) return false

    try {
      lowerShield(bot)
      await bot.equip(apple, 'hand')
      await bot.consume()
      lastPreFightAppleAt = Date.now()
      console.log(`[${username}] pre-fight ${apple.name}`)
      setTimeout(() => autoEquip(bot), 500)
      return true
    } catch (error) {
      console.warn(`[${username}] pre-fight apple failed: ${error.message}`)
      return false
    }
  }

  // ── Auto equip totem in offhand ────────────────────────────────────────
  async function autoTotem(bot) {
    const inv = bot.inventory.items()
    const totem = inv.find(i => i.name === 'totem_of_undying')
    if (!totem) return
    const offhand = bot.inventory.slots[45] // slot 45 = offhand
    if (fighting && (offhand?.name === 'shield' || inv.some(item => item.name === 'shield'))) return
    if (offhand && offhand.name === 'totem_of_undying') return // already has one
    try {
      await bot.equip(totem, 'off-hand')
      console.log(`[${username}] totem equipped in offhand`)
    } catch(e) {
      console.log(`[${username}] totem equip failed: ${e.message}`)
    }
  }

  let shieldRaised = false
  function lowerShield(bot) {
    if (!shieldRaised) return
    bot.deactivateItem()
    shieldRaised = false
  }

  async function setShieldRaised(bot, raised) {
    const offhand = bot.inventory.slots[45]
    const shield = offhand?.name === 'shield'
      ? offhand
      : bot.inventory.items().find(item => item.name === 'shield')

    if (!shield) {
      lowerShield(bot)
      return false
    }

    if (!raised) {
      lowerShield(bot)
      return true
    }

    if (offhand?.name !== 'shield') await bot.equip(shield, 'off-hand')
    if (!shieldRaised) bot.activateItem(true)
    shieldRaised = true
    return true
  }

  // ── Auto drink strength pot ────────────────────────────────────────────
  async function drinkStrengthPot(bot) {
    const inv = bot.inventory.items()
    const pot = inv.find(i =>
      i.name.includes('strength') ||
      (i.name.includes('potion') && i.nbt?.value?.Potion?.value?.includes('strength'))
    )
    if (!pot) return false
    try {
      lowerShield(bot)
      await bot.equip(pot, 'hand')
      await bot.consume()
      console.log(`[${username}] drank strength pot!`)
      setTimeout(() => autoEquip(bot), 500)
      return true
    } catch(e) { return false }
  }

  // ── SKILFUL PvP ENGINE ────────────────────────────────────────────────
  let pvpTarget   = null
  let pvpInterval = null
  let pvpTickRunning = false
  let pvpPathing = false

  function stopPvp() {
    if (!pvpInterval && !pvpTarget && !fighting) return
    if (pvpInterval) { clearInterval(pvpInterval); pvpInterval = null }
    if (pvpPathing) bot.pathfinder.setGoal(null)
    pvpPathing = false
    bot.pvp.stop()
    bot.setControlState('forward', false)
    bot.setControlState('back',    false)
    bot.setControlState('left',    false)
    bot.setControlState('right',   false)
    bot.setControlState('sprint',  false)
    bot.setControlState('jump',    false)
    pvpTarget = null
    fighting  = false
    console.log(`[${username}] pvp stopped`)
    autoEquip(bot)
    autoTotem(bot)
    maintainOwnerFollow()
  }

  async function startPvp(target) {
    if (!target?.isValid || !target.position || !bot.entity) return
    if (pvpTarget === target && fighting) return
    if (pvpInterval) clearInterval(pvpInterval)
    pvpTarget = target
    fighting  = true
    if (followingOwner) bot.pathfinder.setGoal(null)

    await eatGoldenAppleBeforeFight(bot)
    if (pvpTarget !== target || !target.isValid || !target.position || !bot.entity) {
      if (pvpTarget === target) stopPvp()
      return
    }
    await drinkStrengthPot(bot)
    if (pvpTarget !== target || !target.isValid || !target.position || !bot.entity) {
      if (pvpTarget === target) stopPvp()
      return
    }
    await autoEquip(bot)
    if (pvpTarget !== target || !target.isValid || !target.position || !bot.entity) {
      if (pvpTarget === target) stopPvp()
      return
    }

    console.log(`[${username}] engaging ${target.username || target.name || 'entity'}`)

    let tick        = 0
    let lastAttack  = 0
    let nextOpeningAt = Date.now() + 6000
    let openingUntil = 0
const ATTACK_CD = Math.random() * 250 + 420

    pvpInterval = setInterval(async () => {
      if (pvpTickRunning) return
      const target = pvpTarget
      if (!target?.isValid || !target.position || !bot.entity) { stopPvp(); return }

      pvpTickRunning = true
      try {
        const isCurrentTarget = () => pvpTarget === target
          && target.isValid
          && Boolean(target.position)
          && Boolean(bot.entity)
        const dist = bot.entity.position.distanceTo(target.position)
        tick++
        const now = Date.now()
        if (now >= nextOpeningAt) {
          openingUntil = now + 350
          nextOpeningAt = now + 7500
        }
        const opening = now < openingUntil
        await setShieldRaised(bot, !opening && dist <= 4)
        if (!isCurrentTarget()) {
          if (pvpTarget === target) stopPvp()
          return
        }

        // Smart survival before attacking
        if (bot.health <= 10 || (bot.health <= 14 && dist < 3)) {
          await useBestHealingItem(bot, true)
          if (!isCurrentTarget()) {
            if (pvpTarget === target) stopPvp()
            return
          }
        }

        // If very low health, retreat and heal
        if (bot.health <= 8) {
          bot.setControlState('forward', false)
          bot.setControlState('back', true)
          bot.setControlState('sprint', false)
          bot.lookAt(target.position.offset(0, 1.62, 0), true)
          if (await useBestHealingItem(bot, true)) return
          if (!isCurrentTarget()) {
            if (pvpTarget === target) stopPvp()
            return
          }
        }

        // ── 1. Always face target, but add small human jitter so it feels
        // less like a perfect aim-bot. ─────────────────────────────────────
        const lookOffset = {
          x: (Math.random() - 0.5) * 0.35,
          y: (Math.random() - 0.5) * 0.22,
          z: (Math.random() - 0.5) * 0.35,
        }
        bot.lookAt(target.position.offset(lookOffset.x, 1.62 + lookOffset.y, lookOffset.z), true)

        // Let pathfinder handle long chases and vertical routes; use direct
        // movement only when close enough to fight.
        const heightGap = Math.abs(target.position.y - bot.entity.position.y)
        const shouldPathToTarget = bot.health > 8 && (dist > 4.5 || heightGap > 1.25)
        if (shouldPathToTarget) {
          if (!pvpPathing) {
            bot.pathfinder.setGoal(new GoalFollow(target, 3), true)
            pvpPathing = true
          }
          bot.setControlState('forward', false)
          bot.setControlState('back', false)
          bot.setControlState('left', false)
          bot.setControlState('right', false)
        } else {
          if (pvpPathing) {
            bot.pathfinder.setGoal(null)
            pvpPathing = false
          }
          if (bot.health > 8 && dist > 3.5) {
            bot.setControlState('forward', true)
            bot.setControlState('sprint', true)
            bot.setControlState('back', false)
          } else if (bot.health > 8 && dist < 1.5) {
            bot.setControlState('back', true)
            bot.setControlState('forward', false)
            bot.setControlState('sprint', false)
          } else if (bot.health > 8) {
            bot.setControlState('forward', false)
            bot.setControlState('back', false)
          }
        }

        // ── 3. Strafe left/right alternating every 600ms ───────────────
        if (!pvpPathing && bot.health > 8) {
          const strafePhase = Math.floor(tick / 3) % 2
          bot.setControlState('left', strafePhase === 0)
          bot.setControlState('right', strafePhase !== 0)
        }

        // ── 4. Attack with cooldown + CRIT ─────────────────────────────
        if (!opening && dist <= 3.5 && now - lastAttack >= ATTACK_CD) {
          lastAttack = now
          await setShieldRaised(bot, false)
          if (!isCurrentTarget()) {
            if (pvpTarget === target) stopPvp()
            return
          }
          let landedCrit = false
          const heightGap = target.position.y - bot.entity.position.y
          const canJumpForCrit = bot.entity.onGround === true && heightGap < 1.1
          if (canJumpForCrit) {
            bot.setControlState('sprint', false)
            bot.setControlState('jump', true)
            await new Promise(resolve => setTimeout(resolve, 80))
            bot.setControlState('jump', false)

            const critDeadline = Date.now() + 550
            while (Date.now() < critDeadline && isCurrentTarget()) {
              const entity = bot.entity
              const falling = entity.velocity.y < -0.08 && entity.onGround !== true
              if (falling) {
                bot.attack(target)
                console.log(`[${username}] ⚡ CRIT`)
                landedCrit = true
                break
              }
              await new Promise(resolve => setTimeout(resolve, 25))
            }
          }

          if (!landedCrit && isCurrentTarget()) {
            bot.attack(target)
            console.log(`[${username}] ${canJumpForCrit ? 'hit (no crit window)' : 'hit (airborne or height mismatch)'}`)
          }

          bot.setControlState('sprint', false)
          setTimeout(() => {
            if (fighting) bot.setControlState('sprint', true)
          }, 100)
        }

        // ── 5. Auto eat mid-fight ──────────────────────────────────────
        if (bot.food < 15) autoEat(bot)
        if (bot.health <= 12) {
          await useBestHealingItem(bot)
          if (!isCurrentTarget()) {
            if (pvpTarget === target) stopPvp()
            return
          }
        }

        // Pursuit continues while the target entity remains loaded; explicit
        // stop or target loss ends combat.
      } finally {
        pvpTickRunning = false
      }

    }, 200)  // runs 5 times per second
  }

  // ── Auto fight back ────────────────────────────────────────────────────
  bot.on('entityHurt', async (entity) => {
    if (entity !== bot.entity) return
    if (fighting) return

    const currentHealth = bot.health
    const attacker = bot.nearestEntity(candidate => {
      if (!candidate.position || bot.entity.position.distanceTo(candidate.position) >= 10) return false
      return (candidate.type === 'player' && candidate.username !== username)
        || isHostileMob(candidate)
    })
    if (attacker) {
      console.log(`[${username}] retaliating against ${attacker.username || attacker.name || 'hostile mob'}`)
      await startPvp(attacker)
    }
    lastHealth = currentHealth
  })

  // Track health changes for auto eat + totem
  bot.on('health', async () => {
    lastHealth = bot.health

    if (bot.health <= 16) {
      await useBestHealingItem(bot)
    }

    if (bot.food < 15) await autoEat(bot)
    // Always make sure totem is in offhand
    await autoTotem(bot)
    // Auto equip if armor slot is empty
    const helmet = bot.inventory.slots[5]
    if (!helmet) autoEquip(bot)
  })

  // Re-equip + totem when inventory changes
  bot.on('playerCollect', (collector) => {
    if (collector === bot.entity) {
      setTimeout(() => {
        autoEquip(bot)
        autoTotem(bot)
      }, 500)
    }
  })

  // Also check on any window close (chest loot, trade etc)
  bot.on('windowClose', () => {
    setTimeout(() => {
      autoEquip(bot)
      autoTotem(bot)
    }, 300)
  })

  // ── Auth ───────────────────────────────────────────────────────────────
  bot.on('message', (jsonMsg) => {
    const raw  = jsonMsg.toString()
    const text = raw.toLowerCase()

    if (!registered && text.includes('register')) {
      registered = true
      if (registeredBots[username]) {
        bot.chat(`/login ${password}`)
        loggedIn = true
        console.log(`[${username}] /login sent`)
      } else {
        bot.chat(`/register ${password} ${password}`)
        registeredBots[username] = true
        saveRegistered(registeredBots)
        loggedIn = true
        console.log(`[${username}] /register sent`)
      }
      return
    }

    if (!loggedIn && (text.includes('login') || text.includes('log in'))) {
      loggedIn = true
      bot.chat(`/login ${password}`)
      console.log(`[${username}] /login sent`)
      return
    }

    if (text.includes('successfully registered') || text.includes('successfully logged in')) {
      console.log(`[${username}] ✓ auth done`)
      setTimeout(() => {
        autoEquip(bot)
        autoTotem(bot)
      }, 2000)
      return
    }

    // ── Chat command detection ──────────────────────────────────────────
    const clean = raw.replace(/§[0-9a-fk-or]/gi, '').trim()
    const chatMatch = clean.match(/^(?:\[[^\]]*\]\s*)?(\w+)\s*[>»:]+\s*(.+)$/)
                   || clean.match(/^<(\w+)>\s+(.+)$/)
    if (chatMatch) {
      const sender  = chatMatch[1]
      const message = chatMatch[2].trim()
        if (playerNameMatches(sender, OWNER)) {
        handleCommand(bot, username, message)
      }
    }
  })

  // Native chat event fallback
  bot.on('chat', (sender, message) => {
    if (sender === username) return
    if (playerNameMatches(sender, OWNER)) {
      handleCommand(bot, username, message.trim())
    }
  })

  // ── Error handling ──────────────────────────────────────────────────────
  let reconnectTimer = null
  function scheduleReconnect(reasonText = '') {
    if (reconnectTimer || bot._reconnectDisabled) return
    const delay = getReconnectDelay(reasonText)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      createBot(index)
    }, delay)
    console.log(`[${username}] reconnecting in ${delay/1000}s`)
  }

  bot.on('end', (reason) => {
    if (bot._reconnectDisabled) return
    if (followMonitor) {
      clearInterval(followMonitor)
      followMonitor = null
    }
    if (stuckMonitor) {
      clearInterval(stuckMonitor)
      stuckMonitor = null
    }
    if (idleMonitor) {
      clearInterval(idleMonitor)
      idleMonitor = null
    }
    if (bots[index - 1] === bot) {
      bot._connectionState = 'reconnecting'
      bot.entity = null
    }
    scheduleReconnect(reason)
  })

  bot.on('error', err => console.error(`[${username}] error: ${err.message}`))

  bot.on('kicked', (reason) => {
    let parsedReason = reason
    let kickText = ''
    if (typeof reason === 'string') {
      try { parsedReason = JSON.parse(reason) } catch {}
    }
    try {
      function extractText(o) {
        if (typeof o === 'string') return o
        if (!o || typeof o !== 'object') return ''
        if (o.value !== undefined) return extractText(o.value)
        if (Array.isArray(o)) return o.map(extractText).join('')
        return [extractText(o.text), extractText(o.extra), o.translate||''].join('')
      }
      kickText = extractText(parsedReason)
        || (typeof parsedReason === 'string' ? parsedReason : JSON.stringify(parsedReason))
        || 'Unknown kick reason'
    } catch {
      kickText = String(reason || 'Unknown kick reason')
    }
    console.warn(`[${username}] kicked: ${kickText}`)
    if (requiresFabricMods(kickText)) {
      bot._reconnectDisabled = true
      bot._connectionState = 'incompatible'
      bot.entity = null
      console.warn(`[${username}] reconnect paused: this Mineflayer bot cannot load Fabric client mods`)
    } else {
      scheduleReconnect(kickText)
    }
  })

  // Attach pvp engine to bot so handleCommand can reach it
  bot._startPvp = startPvp
  bot._stopPvp  = stopPvp
  bot._followOwner = () => {
    followingOwner = true
    followingBotSlots.add(index)
    followTargetEntity = null
    maintainOwnerFollow()
    return Boolean(followTargetEntity)
  }
  bot._stopFollowing = () => {
    followingOwner = false
    followingBotSlots.delete(index)
    followTargetEntity = null
  }
  bot._dropInventory = async () => {
    const items = [...bot.inventory.items()]
    let droppedStacks = 0
    for (const item of items) {
      try {
        await bot.tossStack(item)
        droppedStacks++
      } catch (error) {
        console.warn(`[${username}] drop stopped: ${error.message}`)
        break
      }
    }
    bot.chat(droppedStacks ? `Dropped ${droppedStacks} inventory stacks.` : 'My inventory is empty.')
    console.log(`[${username}] dropped ${droppedStacks} inventory stacks`)
  }

  bots[index - 1] = bot
  return bot
}

// ── Command handler ────────────────────────────────────────────────────────
function handleCommand(bot, username, message) {
  const msg = message.toLowerCase().trim()
  console.log(`[${username}] cmd: ${message}`)

  // FOLLOW
  if (msg === 'follow') {
    const following = bot._followOwner ? bot._followOwner() : false
    if (!following) bot.chat("I'll follow when I can see you.")
    return
  }

  // STOP
  if (msg === 'stop') {
    if (bot._stopFollowing) bot._stopFollowing()
    if (bot._stopPvp) bot._stopPvp()
    else bot.pvp.stop()
    bot.pathfinder.setGoal(null)
    return
  }

  if (msg === 'drop') {
    if (bot._dropInventory) bot._dropInventory()
    return
  }

  // COME
  if (msg === 'come') {
    const target = findNamedPlayerEntity(bot, OWNER)
    if (!target) { bot.chat("Can't see you!"); return }
    const { x, y, z } = target.position
    bot.pathfinder.setGoal(new GoalNear(x, y, z, 2))
    return
  }

  // ATTACK <player>
  const attackMatch = msg.match(/^attack\s+(\w+)$/)
  if (attackMatch) {
    const targetName = message.slice(7).trim()
    const target = findNamedPlayerEntity(bot, targetName)
    if (!target) { bot.chat(`Can't find ${targetName}`); return }
    bot._startPvp ? bot._startPvp(target) : bot.pvp.attack(target)
    return
  }

  // ATTACK nearest
  if (msg === 'attack') {
    const target = bot.nearestEntity(e =>
      e.type === 'player' && !playerNameMatches(e.username, username) && !playerNameMatches(e.username, OWNER)
    )
    if (!target) { bot.chat('No players nearby'); return }
    bot._startPvp ? bot._startPvp(target) : bot.pvp.attack(target)
    return
  }

  // JUMP
  if (msg === 'jump') {
    bot.setControlState('jump', true)
    setTimeout(() => bot.setControlState('jump', false), 500)
    return
  }

  // LOOK
  if (msg === 'look') {
    const target = findNamedPlayerEntity(bot, OWNER)
    if (target) bot.lookAt(target.position.offset(0, 1.62, 0))
    return
  }

  // EQUIP — manually trigger gear equip
  if (msg === 'equip') {
    const inv = bot.inventory.items()
    const helmets = inv.filter(i => i.name.includes('helmet'))
    helmets.sort((a,b) => armorScore(b.name) - armorScore(a.name))
    if (helmets.length) bot.equip(helmets[0], 'head').catch(()=>{})
    const chests = inv.filter(i => i.name.includes('chestplate'))
    chests.sort((a,b) => armorScore(b.name) - armorScore(a.name))
    if (chests.length) bot.equip(chests[0], 'torso').catch(()=>{})
    const legs = inv.filter(i => i.name.includes('leggings'))
    legs.sort((a,b) => armorScore(b.name) - armorScore(a.name))
    if (legs.length) bot.equip(legs[0], 'legs').catch(()=>{})
    const boots = inv.filter(i => i.name.includes('boots'))
    boots.sort((a,b) => armorScore(b.name) - armorScore(a.name))
    if (boots.length) bot.equip(boots[0], 'feet').catch(()=>{})
    const weapons = inv.filter(i => weaponScore(i.name) > -1)
    weapons.sort((a,b) => weaponScore(b.name) - weaponScore(a.name))
    if (weapons.length) bot.equip(weapons[0], 'hand').catch(()=>{})
    console.log(`[${username}] equip triggered`)
    return
  }

  // [text] — send anything in chat including /commands
  const typeMatch = message.match(/^\[(.+)\]$/)
  if (typeMatch) {
    bot.chat(typeMatch[1])
    return
  }

  // GOTO
  const gotoMatch = msg.match(/^goto\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)$/)
  if (gotoMatch) {
    const [, x, y, z] = gotoMatch.map(Number)
    bot.pathfinder.setGoal(new GoalNear(x, y, z, 1))
    return
  }
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const { host: runtimeHost, port: runtimePort, version: runtimeVersion } = getServerConfig()
  console.log(`\n${'═'.repeat(52)}`)
  console.log(` BOT ARMY  →  ${runtimeHost}:${runtimePort}  |  Owner: ${OWNER}`)
  console.log(` Mode: ${USE_TOKENS ? '🔑 Token' : '📴 Offline'}  |  Bots: ${BOT_COUNT}`)
  console.log(` Version: ${runtimeVersion}`)
  console.log(`${'═'.repeat(52)}`)
  console.log(' Commands: follow | come | stop | attack [name]')
  console.log(' equip | jump | look | goto x y z | [/cmd]')
  console.log(`${'═'.repeat(52)}\n`)

  if (!isServerConfigured()) {
    console.log('[army] neutral mode: waiting for a server IP from the dashboard')
    return
  }

  startBotArmy()
}

if (isServerConfigured()) {
  main()
} else {
  console.log('[army] neutral mode: no server configured; bots will wait until an IP is entered in the site')
}

module.exports = {
  bots,
  handleCommand,
  BOT_COUNT,
  getServerConfig,
  setServerConfig,
  SERVER_CONFIG: getServerConfig(),
}

if (require.main === module) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' })
  rl.prompt()
  rl.on('line', (line) => {
    const input = line.trim()
    if (!input) { rl.prompt(); return }
    const activeBots = bots.filter(b => b && b.entity)
    if (input.toLowerCase() === 'list') {
      console.log(`Online: ${activeBots.length}/${bots.length}`)
      activeBots.forEach(b => console.log(`  • ${b.username} HP:${Math.round(b.health)} Food:${Math.round(b.food)}`))
      rl.prompt(); return
    }
    if (!activeBots.length) { console.log('No bots online yet.'); rl.prompt(); return }
    activeBots.forEach(b => handleCommand(b, b.username, input))
    rl.prompt()
  })
}
