import os from "os"
import fs from "fs"
import dotenv from "dotenv"
import path from "path"
import WebSocket from "ws"
import http from "http"
import https from "https"
import readline from "readline"
import chalk from "chalk"
import copyToClipboard from "./copyToClipboard"
import { randomUUID } from "crypto"
import { URL } from "url"
import { log, cleanOldLogs } from "./logger"

dotenv.config()

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

const APP_NAME = process.env.APP_NAME || "BENgrok"
const BASE_DIR = path.join(os.homedir(), APP_NAME)
const TUNNEL_FILE = path.join(BASE_DIR, "tunnel_url.txt")
const PROFILE_FILE = path.join(BASE_DIR, "profiles.json")

type TunnelEntry = {
  index: number
  friendlyName: string
  publicUrl: string
}

type SavedProfileEntry = {
  FriendlyName: string
  URL: string
  TunnelId: string
}

type SavedProfiles = Record<string, SavedProfileEntry[]>

const activeTunnels: TunnelEntry[] = []

const ask = (question: string): Promise<string> => {
  return new Promise((resolve) =>
    rl.question(question, (answer) => resolve(answer.trim()))
  )
}

const askYesNo = async (question: string): Promise<boolean> => {
  const response = await ask(`${question} (Y/n): `)
  return response.toLowerCase() === "y" || response === ""
}

const getTunnelURL = async (): Promise<string> => {
  if (fs.existsSync(TUNNEL_FILE)) {
    const stored = fs
      .readFileSync(TUNNEL_FILE, "utf-8")
      .trim()
      .replace(/\/+$/, "")
    if (stored) {
      const reuse = await askYesNo(`🔁 Use saved tunnel URL (${stored})?`)
      if (reuse) return stored
    }
  }

  const input = await ask("🌐 Enter your tunnel server URL: ")
  const clean = input.trim().replace(/\/+$/, "")
  fs.mkdirSync(BASE_DIR, { recursive: true })
  fs.writeFileSync(TUNNEL_FILE, clean)
  return clean
}

const loadProfiles = (): SavedProfiles => {
  fs.mkdirSync(BASE_DIR, { recursive: true })

  if (!fs.existsSync(PROFILE_FILE)) {
    fs.writeFileSync(PROFILE_FILE, JSON.stringify({}, null, 2))
    return {}
  }

  try {
    return JSON.parse(fs.readFileSync(PROFILE_FILE, "utf-8"))
  } catch {
    console.log(chalk.red("⚠️ Failed to read profiles.json — resetting."))
    fs.writeFileSync(PROFILE_FILE, JSON.stringify({}, null, 2))
    return {}
  }
}


const saveProfiles = (profiles: SavedProfiles) => {
  fs.mkdirSync(BASE_DIR, { recursive: true })
  fs.writeFileSync(PROFILE_FILE, JSON.stringify(profiles, null, 2))
}

const saveProfile = (name: string, entries: SavedProfileEntry[]) => {
  const profiles = loadProfiles()
  profiles[name] = entries
  saveProfiles(profiles)
  console.log(chalk.green(`💾 Saved profile '${name}'`))
}

const startTunnel = async (
  baseUrl: string,
  entry: SavedProfileEntry,
  index: number
) => {
  const parsedTarget = new URL(entry.URL)
  const tunnelId = entry.TunnelId
  const publicUrl: string = `${baseUrl}/tunnel/${tunnelId}`

  activeTunnels.push({
    index,
    friendlyName: entry.FriendlyName,
    publicUrl,
  })

  const ws = new WebSocket(`${baseUrl}?id=${tunnelId}`)
  const useHttps = parsedTarget.protocol === "https:"
  const proxyRequest = useHttps ? https.request : http.request

  let heartbeatInterval: NodeJS.Timeout

  ws.on("open", () => {
    const logMsg = chalk.green(
      `✅ Tunnel Ready [${index}]: ${publicUrl} → ${entry.FriendlyName} (${entry.URL})`
    )
    console.log(logMsg)
    log(logMsg)

    heartbeatInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping()
        log(chalk.gray(`[${tunnelId}] Ping sent`))
      }
    }, 30000)
  })

  ws.on("pong", () => {
    log(chalk.gray(`[${tunnelId}] Pong received`))
  })

  ws.on("close", () => {
    clearInterval(heartbeatInterval)
    const logMsg = chalk.yellow(`[${tunnelId}] Disconnected from server`)
    console.log(logMsg)
    log(logMsg)
  })

  ws.on("error", (err) => {
    const logMsg = chalk.red(`[${tunnelId}] WebSocket error: ${err.message}`)
    console.error(logMsg)
    log(logMsg)
  })

  ws.on("message", (message) => {
    const req = JSON.parse(message.toString())

    const options: http.RequestOptions = {
      hostname: parsedTarget.hostname,
      port: parseInt(parsedTarget.port || (useHttps ? "443" : "80")),
      path: parsedTarget.pathname + (req.url || ""),
      method: req.method,
      headers: {
        ...req.headers,
        "x-tunnel-id": tunnelId,
        host: parsedTarget.host,
      },
    }

    const proxyReq = proxyRequest(options, (proxyRes) => {
      let body = ""
      proxyRes.on("data", (chunk) => (body += chunk))
      proxyRes.on("end", () => {
        ws.send(
          JSON.stringify({
            statusCode: proxyRes.statusCode,
            headers: proxyRes.headers,
            body,
          })
        )
        const logMsg = chalk.cyan(
          `[${tunnelId}] ${req.method} ${req.url} → ${proxyRes.statusCode} (${entry.FriendlyName})`
        )
        console.log(logMsg)
        log(logMsg)
      })
    })

    proxyReq.on("error", (err) => {
      ws.send(
        JSON.stringify({
          statusCode: 500,
          headers: {},
          body: `Tunnel error: ${err.message}`,
        })
      )
      const logMsg = chalk.red(`[${tunnelId}] Proxy error: ${err.message}`)
      console.error(logMsg)
      log(logMsg)
    })

    proxyReq.write(req.body || "")
    proxyReq.end()
  })
}

const collectTunnels = async (): Promise<SavedProfileEntry[]> => {
  const entries: SavedProfileEntry[] = []

  while (true) {
    const name = await ask("📝 Enter a friendly name for this tunnel: ")
    const url = await ask("🔗 Enter the full target URL: ")

    try {
      const parsed = new URL(url)
      entries.push({
        FriendlyName: name,
        URL: parsed.href,
        TunnelId: randomUUID().slice(0, 8),
      })
    } catch {
      console.log(chalk.red("❌ Invalid URL, skipping this entry"))
    }

    const addMore = await askYesNo("➕ Add another tunnel?")
    if (!addMore) break
  }

  return entries
}

const displayTunnelList = () => {
  console.log(chalk.cyan("\n📋 Active Tunnels:"))
  activeTunnels
    .sort((a, b) => a.index - b.index)
    .forEach((tunnel) => {
      console.log(`  [${tunnel.index}] ${tunnel.friendlyName}: ${tunnel.publicUrl}`)
    })
}

const setupClipboardShortcuts = () => {
  activeTunnels.sort((a, b) => a.index - b.index)
  displayTunnelList()

  console.log(
    chalk.yellow("\n⌨️  Press a number (1, 2, 3, ...) to copy a tunnel URL to clipboard. Press Ctrl+C to exit.\n")
  )

  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.setEncoding("utf8")

  process.stdin.on("data", (key) => {
    //@ts-ignore
    const num = parseInt(key)
    if (!isNaN(num)) {
      const tunnel = activeTunnels.find((t) => t.index === num)
      if (tunnel) {
        copyToClipboard(tunnel.publicUrl)
        console.log(
          chalk.magenta(`📋 Copied ${tunnel.friendlyName} URL to clipboard: ${tunnel.publicUrl}`)
        )
      } else {
        console.log(chalk.red(`❌ No tunnel found for index ${num}`))
      }
    }
    //@ts-ignore
    if (key === "\u0003") {
      console.log(chalk.gray("\n👋 Exiting..."))
      process.exit()
    }
  })
}

const main = async () => {
  cleanOldLogs()

  const tunnelURL = await getTunnelURL()
  const profiles = loadProfiles()
  let entries: SavedProfileEntry[] = []

  if (Object.keys(profiles).length > 0) {
    const useProfile = await askYesNo("📂 Load a saved tunnel profile?")
    if (useProfile) {
      const profileNames = Object.keys(profiles)
      console.log(chalk.cyan("\nAvailable profiles:"))
      profileNames.forEach((name, i) => {
        console.log(`  [${i + 1}] ${name}`)
      })

      const choice = await ask("Enter profile number: ")
      const idx = parseInt(choice) - 1
      const selected = profileNames[idx]
      if (selected && profiles[selected]) {
        entries = profiles[selected]
        console.log(chalk.green(`✅ Loaded profile '${selected}' with ${entries.length} tunnel(s).`))
      } else {
        console.log(chalk.red("❌ Invalid profile selection."))
        rl.close()
        return
      }
    }
  }

  if (entries.length === 0) {
    entries = await collectTunnels()

    if (entries.length) {
      const save = await askYesNo("💾 Save these entries as a new profile?")
      if (save) {
        const profileName = await ask("📝 Enter profile name: ")
        saveProfile(profileName, entries)
      }
    }
  }

  if (!entries.length) {
    console.log(chalk.red("❌ No tunnels to start. Exiting."))
    rl.close()
    return
  }

  const logMsg = chalk.blue("\n🚀 Starting tunnel(s)...\n")
  console.log(logMsg)
  log(logMsg)

  for (let i = 0; i < entries.length; i++) {
    await startTunnel(tunnelURL, entries[i], i + 1)
  }

  rl.close()
  setupClipboardShortcuts()
}

main()
