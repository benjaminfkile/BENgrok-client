import dotenv from "dotenv"
import WebSocket from "ws"
import http from "http"
import readline from "readline"
import chalk from "chalk"
import { randomUUID } from "crypto"

dotenv.config()

const BASE_TUNNEL_URL = process.env.TUNNEL_URL
if (!BASE_TUNNEL_URL) {
  console.error(chalk.red("❌ Missing TUNNEL_URL in .env file"))
  process.exit(1)
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

const args = process.argv.slice(2)
const portsFromFlags: number[] = []
let customHost: string | undefined

args.forEach(arg => {
  if (arg.startsWith("--port=")) {
    portsFromFlags.push(...arg.split("=")[1].split(",").map(Number).filter(Boolean))
  } else if (arg.startsWith("--host=")) {
    customHost = arg.split("=")[1]
  }
})

const startTunnel = (port: number) => {
  const tunnelId = randomUUID().slice(0, 8) // unique short tunnel ID
  const ws = new WebSocket(`${BASE_TUNNEL_URL}?id=${tunnelId}`)

  let heartbeatInterval: NodeJS.Timeout

  ws.on("open", () => {
    console.log(chalk.green(`[${tunnelId}] Connected → http(s)://your-domain/tunnel/${tunnelId}/* → localhost:${port}`))

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
    console.log(chalk.yellow(`[${tunnelId}] Disconnected from tunnel server`))
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
        ...(customHost ? { host: customHost } : {})
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

const askPorts = () => {
  rl.question("Enter port(s) to expose (comma-separated): ", (input) => {
    const ports = input.split(",").map(p => parseInt(p.trim())).filter(Boolean)

    if (!ports.length) {
      console.log("No valid ports entered.")
      rl.close()
      process.exit(1)
    }

    ports.forEach(port => startTunnel(port))
    rl.close()
  })
}

if (portsFromFlags.length) {
  portsFromFlags.forEach(port => startTunnel(port))
} else {
  askPorts()
}
