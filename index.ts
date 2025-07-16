import fs from "fs";
import path from "path";
import WebSocket from "ws";
import http from "http";
import readline from "readline";
import chalk from "chalk";
import { randomUUID } from "crypto";
import { log, cleanOldLogs } from "./logger";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const TUNNEL_FILE = path.resolve(__dirname, "../tunnel_url.txt");

const ask = (question: string): Promise<string> => {
  return new Promise((resolve) =>
    rl.question(question, (answer) => resolve(answer.trim()))
  );
};

const getTunnelURL = async (): Promise<string> => {
  if (fs.existsSync(TUNNEL_FILE)) {
    const stored = fs
      .readFileSync(TUNNEL_FILE, "utf-8")
      .trim()
      .replace(/\/+$/, "");
    if (stored) {
      const reuse = await ask(`🔁 Use saved tunnel URL (${stored})? (Y/n): `);
      if (reuse.toLowerCase() === "y" || reuse === "") {
        return stored;
      }
    }
  }

  const input = await ask("🌐 Enter your tunnel server URL: ");
  const clean = input.trim().replace(/\/+$/, "");
  fs.writeFileSync(TUNNEL_FILE, clean);
  return clean;
};

const startTunnel = async (
  baseUrl: string,
  port: number,
  customHost?: string
) => {
  const tunnelId = randomUUID().slice(0, 8);
  const ws = new WebSocket(`${baseUrl}?id=${tunnelId}`);

  let heartbeatInterval: NodeJS.Timeout;

  ws.on("open", () => {
    const logMsg = chalk.green(
      `✅ Tunnel Ready: ${baseUrl}/tunnel/${tunnelId} → localhost:${port}`
    );
    console.log(logMsg);
    log(logMsg);

    heartbeatInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        log(chalk.gray(`[${tunnelId}] Ping sent`));
      }
    }, 30000);
  });

  ws.on("pong", () => {
    log(chalk.gray(`[${tunnelId}] Pong received`));
  });

  ws.on("close", () => {
    clearInterval(heartbeatInterval);
    const logMsg = chalk.yellow(`[${tunnelId}] Disconnected from server`);
    console.log(logMsg);
    log(logMsg);
  });

  ws.on("error", (err) => {
    const logMsg = chalk.red(`[${tunnelId}] WebSocket error: ${err.message}`);
    console.error(logMsg);
    log(logMsg);
  });

  ws.on("message", (message) => {
    const req = JSON.parse(message.toString());

    const options: http.RequestOptions = {
      hostname: "localhost",
      port,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        "x-tunnel-id": tunnelId,
        host: customHost || "localhost",
      },
    };

    const proxyReq = http.request(options, (proxyRes) => {
      let body = "";
      proxyRes.on("data", (chunk) => (body += chunk));
      proxyRes.on("end", () => {
        ws.send(
          JSON.stringify({
            statusCode: proxyRes.statusCode,
            headers: proxyRes.headers,
            body,
          })
        );
        const logMsg = chalk.cyan(
          `[${tunnelId}] ${req.method} ${req.url} → ${proxyRes.statusCode}`
        );
        console.log(logMsg);
        log(logMsg);
      });
    });

    proxyReq.on("error", (err) => {
      ws.send(
        JSON.stringify({
          statusCode: 500,
          headers: {},
          body: `Tunnel error: ${err.message}`,
        })
      );
      const logMsg = chalk.red(`[${tunnelId}] Proxy error: ${err.message}`);
      console.error(logMsg);
      log(logMsg);
    });

    proxyReq.write(req.body);
    proxyReq.end();
  });
};

const main = async () => {

  cleanOldLogs();

  const tunnelURL = await getTunnelURL();

  const portInput = await ask("🔌 Enter port(s) to expose (comma-separated): ");
  const ports = portInput
    .split(",")
    .map((p) => parseInt(p.trim()))
    .filter(Boolean);

  if (!ports.length) {
    const logMsg = chalk.red("❌ No valid ports entered. Exiting.");
    console.log(logMsg);
    log(logMsg);
    rl.close();
    return;
  }

  const hostInput = await ask(
    "🌐 Optional: custom Host header (blank for localhost): "
  );
  const customHost = hostInput.trim() || undefined;

  const logMsg = chalk.blue("\n🎯 Starting tunnels...\n");
  console.log(logMsg);
  log(logMsg);
  for (const port of ports) {
    startTunnel(tunnelURL, port, customHost);
  }

  rl.close();
};

main();