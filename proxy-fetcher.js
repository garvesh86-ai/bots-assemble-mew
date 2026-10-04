const axios  = require('axios')
const { SocksClient } = require('socks')

// Asian country codes to prefer
const ASIAN_COUNTRIES = ['IN', 'SG', 'JP', 'KR', 'HK', 'TW', 'TH', 'ID', 'MY', 'PH', 'VN', 'CN']

// Sources that return plain text proxy lists (host:port per line)
const PROXY_SOURCES = [
  'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt',
  'https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt',
  'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/socks5.txt',
  'https://raw.githubusercontent.com/manuGMG/proxy-365/main/SOCKS5.txt',
  'https://raw.githubusercontent.com/roosterkid/openproxylist/main/SOCKS5_RAW.txt',
]

// Test if a proxy can connect to the target server within timeout
async function testProxy(proxy, targetHost, targetPort, timeoutMs = 5000) {
  try {
    await SocksClient.createConnection({
      proxy: { host: proxy.host, port: proxy.port, type: 5 },
      command: 'connect',
      destination: { host: targetHost, port: targetPort },
      timeout: timeoutMs
    })
    return true
  } catch {
    return false
  }
}

// Fetch proxies from all sources and return unique list
async function fetchRawProxies() {
  const all = new Set()
  for (const url of PROXY_SOURCES) {
    try {
      const res = await axios.get(url, { timeout: 8000 })
      const lines = res.data.split('\n')
      for (const line of lines) {
        const clean = line.trim()
        if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(clean)) {
          all.add(clean)
        }
      }
      console.log(`[proxy-fetcher] ${url.split('/')[4]} → ${all.size} total so far`)
    } catch (e) {
      console.warn(`[proxy-fetcher] failed to fetch ${url}: ${e.message}`)
    }
  }
  return [...all].map(entry => {
    const [host, port] = entry.split(':')
    return { host, port: parseInt(port), userId: '', password: '' }
  })
}

// Main export — fetches, tests, returns N working proxies
async function getWorkingProxies(targetHost, targetPort, needed = 5) {
  console.log(`[proxy-fetcher] fetching proxy lists…`)
  const raw = await fetchRawProxies()
  console.log(`[proxy-fetcher] ${raw.length} proxies fetched, testing for ${targetHost}:${targetPort}…`)

  const working = []
  let tested = 0

  // Shuffle so we don't always test the same ones
  raw.sort(() => Math.random() - 0.5)

  for (const proxy of raw) {
    if (working.length >= needed) break
    tested++
    process.stdout.write(`\r[proxy-fetcher] tested ${tested}/${raw.length} | found ${working.length}/${needed} working`)
    const ok = await testProxy(proxy, targetHost, targetPort, 4000)
    if (ok) {
      working.push(proxy)
      console.log(`\n[proxy-fetcher] ✓ ${proxy.host}:${proxy.port}`)
    }
  }

  console.log(`\n[proxy-fetcher] done — ${working.length} working proxies found`)
  return working
}

module.exports = { getWorkingProxies }
