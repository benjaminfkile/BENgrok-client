"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const ws_1 = __importDefault(require("ws"));
const http_1 = __importDefault(require("http"));
const readline_1 = __importDefault(require("readline"));
const chalk_1 = __importDefault(require("chalk"));
const crypto_1 = require("crypto");
const logger_1 = require("./logger");
const rl = readline_1.default.createInterface({
    input: process.stdin,
    output: process.stdout,
});
const TUNNEL_FILE = path_1.default.resolve(__dirname, "../tunnel_url.txt");
const ask = (question) => {
    return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
};
const getTunnelURL = () => __awaiter(void 0, void 0, void 0, function* () {
    if (fs_1.default.existsSync(TUNNEL_FILE)) {
        const stored = fs_1.default
            .readFileSync(TUNNEL_FILE, "utf-8")
            .trim()
            .replace(/\/+$/, "");
        if (stored) {
            const reuse = yield ask(`🔁 Use saved tunnel URL (${stored})? (Y/n): `);
            if (reuse.toLowerCase() === "y" || reuse === "") {
                return stored;
            }
        }
    }
    const input = yield ask("🌐 Enter your tunnel server URL: ");
    const clean = input.trim().replace(/\/+$/, "");
    fs_1.default.writeFileSync(TUNNEL_FILE, clean);
    return clean;
});
const startTunnel = (baseUrl, port, customHost) => __awaiter(void 0, void 0, void 0, function* () {
    const tunnelId = (0, crypto_1.randomUUID)().slice(0, 8);
    const ws = new ws_1.default(`${baseUrl}?id=${tunnelId}`);
    let heartbeatInterval;
    ws.on("open", () => {
        const logMsg = chalk_1.default.green(`✅ Tunnel Ready: ${baseUrl}/tunnel/${tunnelId} → localhost:${port}`);
        console.log(logMsg);
        (0, logger_1.log)(logMsg);
        heartbeatInterval = setInterval(() => {
            if (ws.readyState === ws_1.default.OPEN) {
                ws.ping();
                (0, logger_1.log)(chalk_1.default.gray(`[${tunnelId}] Ping sent`));
            }
        }, 30000);
    });
    ws.on("pong", () => {
        (0, logger_1.log)(chalk_1.default.gray(`[${tunnelId}] Pong received`));
    });
    ws.on("close", () => {
        clearInterval(heartbeatInterval);
        const logMsg = chalk_1.default.yellow(`[${tunnelId}] Disconnected from server`);
        console.log(logMsg);
        (0, logger_1.log)(logMsg);
    });
    ws.on("error", (err) => {
        const logMsg = chalk_1.default.red(`[${tunnelId}] WebSocket error: ${err.message}`);
        console.error(logMsg);
        (0, logger_1.log)(logMsg);
    });
    ws.on("message", (message) => {
        const req = JSON.parse(message.toString());
        const options = {
            hostname: "localhost",
            port,
            path: req.url,
            method: req.method,
            headers: Object.assign(Object.assign({}, req.headers), { "x-tunnel-id": tunnelId, host: customHost || "localhost" }),
        };
        const proxyReq = http_1.default.request(options, (proxyRes) => {
            let body = "";
            proxyRes.on("data", (chunk) => (body += chunk));
            proxyRes.on("end", () => {
                ws.send(JSON.stringify({
                    statusCode: proxyRes.statusCode,
                    headers: proxyRes.headers,
                    body,
                }));
                const logMsg = chalk_1.default.cyan(`[${tunnelId}] ${req.method} ${req.url} → ${proxyRes.statusCode}`);
                console.log(logMsg);
                (0, logger_1.log)(logMsg);
            });
        });
        proxyReq.on("error", (err) => {
            ws.send(JSON.stringify({
                statusCode: 500,
                headers: {},
                body: `Tunnel error: ${err.message}`,
            }));
            const logMsg = chalk_1.default.red(`[${tunnelId}] Proxy error: ${err.message}`);
            console.error(logMsg);
            (0, logger_1.log)(logMsg);
        });
        proxyReq.write(req.body);
        proxyReq.end();
    });
});
const main = () => __awaiter(void 0, void 0, void 0, function* () {
    (0, logger_1.cleanOldLogs)();
    const tunnelURL = yield getTunnelURL();
    const portInput = yield ask("🔌 Enter port(s) to expose (comma-separated): ");
    const ports = portInput
        .split(",")
        .map((p) => parseInt(p.trim()))
        .filter(Boolean);
    if (!ports.length) {
        const logMsg = chalk_1.default.red("❌ No valid ports entered. Exiting.");
        console.log(logMsg);
        (0, logger_1.log)(logMsg);
        rl.close();
        return;
    }
    const hostInput = yield ask("🌐 Optional: custom Host header (blank for localhost): ");
    const customHost = hostInput.trim() || undefined;
    const logMsg = chalk_1.default.blue("\n🎯 Starting tunnels...\n");
    console.log(logMsg);
    (0, logger_1.log)(logMsg);
    for (const port of ports) {
        startTunnel(tunnelURL, port, customHost);
    }
    rl.close();
});
main();
