import fs from "fs"
import path from "path"
import WebSocket from "ws"
import http from "http"
import readline from "readline"
import chalk from "chalk"
import { randomUUID } from "crypto"

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

const TUNNEL_FILE = path.resolve(__dirname, "../tunnel_url.txt")

const ask = (question: string): Promise<string> => {
  return new Promise(resolve => rl.question(question, answer => resolve(answer.trim())))
}

const getTunnelURL = async (): Promise<string> => {
  if (fs.existsSync(TUNNEL_FILE)) {
    const raw = fs.readFileSync(TUNNEL_FILE, "utf-8").trim().replace(/\/+$/, "")
    if (raw) return raw
  }

  const input = await ask("🌐 Enter your tunnel server URL: ")
  const clean = input.trim().replace(/\/+$/, "")
  fs.writeFileSync(TUNNEL_FILE, clean)
  return clean
}

const startTunnel = async (baseUrl: string, port: number, customHost?: string) => {
  const tunnelId = randomUUID().slice(0, 8)
  const ws = new WebSocket(`${baseUrl}?id=${tunnelId}`)

  let heartbeatInterval: NodeJS.Timeout

  ws.on("open", () => {
    console.log(chalk.green(`✅ Tunnel Ready: ${baseUrl}/tunnel/${tunnelId} → localhost:${port}`))

    heartbeatInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping()
        console.log(chalk.gray(`[${tunnelId}] Ping sent`))
      }
    }, 30000)
  })

  ws.on("pong", () => {
    console.log(chalk.gray(`[${tunnelId}] Pong received`))
  })

  ws.on("close", () => {
    clearInterval(heartbeatInterval)
    console.log(chalk.yellow(`[${tunnelId}] Disconnected from server`))
  })

  ws.on("error", (err) => {
    console.error(chalk.red(`[${tunnelId}] WebSocket error: ${err.message}`))
  })

  ws.on("message", (message) => {
    const req = JSON.parse(message.toString())

    const options: http.RequestOptions = {
      hostname: "localhost",
      port,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        "x-tunnel-id": tunnelId,
        host: customHost || "localhost"
      }
    }

    const proxyReq = http.request(options, (proxyRes) => {
      let body = ""
      proxyRes.on("data", chunk => body += chunk)
      proxyRes.on("end", () => {
        ws.send(JSON.stringify({
          statusCode: proxyRes.statusCode,
          headers: proxyRes.headers,
          body
        }))
        console.log(chalk.cyan(`[${tunnelId}] ${req.method} ${req.url} → ${proxyRes.statusCode}`))
      })
    })

    proxyReq.on("error", (err) => {
      ws.send(JSON.stringify({
        statusCode: 500,
        headers: {},
        body: `Tunnel error: ${err.message}`
      }))
      console.error(chalk.red(`[${tunnelId}] Proxy error: ${err.message}`))
    })

    proxyReq.write(req.body)
    proxyReq.end()
  })
}

const main = async () => {
  const tunnelURL = await getTunnelURL()

  const portInput = await ask("🔌 Enter port(s) to expose (comma-separated): ")
  const ports = portInput.split(",").map(p => parseInt(p.trim())).filter(Boolean)

  if (!ports.length) {
    console.log(chalk.red("❌ No valid ports entered. Exiting."))
    rl.close()
    return
  }

  const hostInput = await ask("🌐 Optional: custom Host header (blank for localhost): ")
  const customHost = hostInput.trim() || undefined

  console.log(chalk.blue("\n🎯 Starting tunnels...\n"))
  for (const port of ports) {
    startTunnel(tunnelURL, port, customHost)
  }

  rl.close()
}

main()
