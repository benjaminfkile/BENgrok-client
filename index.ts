import os from "os"
import fs from "fs"
import dotenv from "dotenv"
import path from "path"
import WebSocket from "ws"
import http from "http"
import https from "https"
import readline from "readline"
import chalk from "chalk"
import clipboard from "clipboardy"
import { randomUUID } from "crypto"
import { URL } from "url"
import { log, cleanOldLogs } from "./logger"

dotenv.config()

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

const APP_NAME = process.env.APP_NAME || "BENgrok"
const TUNNEL_FILE = path.join(os.homedir(), APP_NAME, "tunnel_url.txt")

type TunnelEntry = {
  index: number
  friendlyName: string
  publicUrl: string
}

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
  fs.writeFileSync(TUNNEL_FILE, clean)
  return clean
}

const startTunnel = async (
  baseUrl: string,
  targetUrl: string,
  friendlyName: string,
  index: number
) => {
  const parsedTarget = new URL(targetUrl)
  const tunnelId = randomUUID().slice(0, 8)
  const publicUrl: string = `${baseUrl}/tunnel/${tunnelId}`

  // Ensure insertion order is preserved
  activeTunnels.push({
    index,
    friendlyName,
    publicUrl,
  })

  const ws = new WebSocket(`${baseUrl}?id=${tunnelId}`)

  let heartbeatInterval: NodeJS.Timeout
  const useHttps = parsedTarget.protocol === "https:"
  const proxyRequest = useHttps ? https.request : http.request

  ws.on("open", () => {
    const logMsg = chalk.green(
      `✅ Tunnel Ready [${index}]: ${publicUrl} → ${friendlyName} (${targetUrl})`
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
          `[${tunnelId}] ${req.method} ${req.url} → ${proxyRes.statusCode} (${friendlyName})`
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

const collectTunnels = async (): Promise<{ FriendlyName: string; URL: string }[]> => {
  const entries: { FriendlyName: string; URL: string }[] = []

  while (true) {
    const name = await ask("📝 Enter a friendly name for this tunnel: ")
    const url = await ask("🔗 Enter the full target URL: ")

    try {
      const parsed = new URL(url)
      entries.push({ FriendlyName: name, URL: parsed.href })
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
        clipboard.writeSync(tunnel.publicUrl)
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
  const entries = await collectTunnels()

  if (!entries.length) {
    const logMsg = chalk.red("❌ No tunnels defined. Exiting.")
    console.log(logMsg)
    log(logMsg)
    rl.close()
    return
  }

  const logMsg = chalk.blue("\n🚀 Starting tunnel(s)...\n")
  console.log(logMsg)
  log(logMsg)

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    await startTunnel(tunnelURL, entry.URL, entry.FriendlyName, i + 1)
  }

  rl.close()
  setupClipboardShortcuts()
}

main()