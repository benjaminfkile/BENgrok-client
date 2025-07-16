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
const os_1 = __importDefault(require("os"));
const fs_1 = __importDefault(require("fs"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const ws_1 = __importDefault(require("ws"));
const http_1 = __importDefault(require("http"));
const https_1 = __importDefault(require("https"));
const readline_1 = __importDefault(require("readline"));
const chalk_1 = __importDefault(require("chalk"));
const clipboardy_1 = __importDefault(require("clipboardy"));
const crypto_1 = require("crypto");
const url_1 = require("url");
const logger_1 = require("./logger");
dotenv_1.default.config();
const rl = readline_1.default.createInterface({
    input: process.stdin,
    output: process.stdout,
});
const APP_NAME = process.env.APP_NAME || "BENgrok";
const TUNNEL_FILE = path_1.default.join(os_1.default.homedir(), APP_NAME, "tunnel_url.txt");
const activeTunnels = [];
const ask = (question) => {
    return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
};
const askYesNo = (question) => __awaiter(void 0, void 0, void 0, function* () {
    const response = yield ask(`${question} (Y/n): `);
    return response.toLowerCase() === "y" || response === "";
});
const getTunnelURL = () => __awaiter(void 0, void 0, void 0, function* () {
    if (fs_1.default.existsSync(TUNNEL_FILE)) {
        const stored = fs_1.default
            .readFileSync(TUNNEL_FILE, "utf-8")
            .trim()
            .replace(/\/+$/, "");
        if (stored) {
            const reuse = yield askYesNo(`🔁 Use saved tunnel URL (${stored})?`);
            if (reuse)
                return stored;
        }
    }
    const input = yield ask("🌐 Enter your tunnel server URL: ");
    const clean = input.trim().replace(/\/+$/, "");
    fs_1.default.writeFileSync(TUNNEL_FILE, clean);
    return clean;
});
const startTunnel = (baseUrl, targetUrl, friendlyName, index) => __awaiter(void 0, void 0, void 0, function* () {
    const parsedTarget = new url_1.URL(targetUrl);
    const tunnelId = (0, crypto_1.randomUUID)().slice(0, 8);
    const publicUrl = `${baseUrl}/tunnel/${tunnelId}`;
    // Ensure insertion order is preserved
    activeTunnels.push({
        index,
        friendlyName,
        publicUrl,
    });
    const ws = new ws_1.default(`${baseUrl}?id=${tunnelId}`);
    let heartbeatInterval;
    const useHttps = parsedTarget.protocol === "https:";
    const proxyRequest = useHttps ? https_1.default.request : http_1.default.request;
    ws.on("open", () => {
        const logMsg = chalk_1.default.green(`✅ Tunnel Ready [${index}]: ${publicUrl} → ${friendlyName} (${targetUrl})`);
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
            hostname: parsedTarget.hostname,
            port: parseInt(parsedTarget.port || (useHttps ? "443" : "80")),
            path: parsedTarget.pathname + (req.url || ""),
            method: req.method,
            headers: Object.assign(Object.assign({}, req.headers), { "x-tunnel-id": tunnelId, host: parsedTarget.host }),
        };
        const proxyReq = proxyRequest(options, (proxyRes) => {
            let body = "";
            proxyRes.on("data", (chunk) => (body += chunk));
            proxyRes.on("end", () => {
                ws.send(JSON.stringify({
                    statusCode: proxyRes.statusCode,
                    headers: proxyRes.headers,
                    body,
                }));
                const logMsg = chalk_1.default.cyan(`[${tunnelId}] ${req.method} ${req.url} → ${proxyRes.statusCode} (${friendlyName})`);
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
        proxyReq.write(req.body || "");
        proxyReq.end();
    });
});
const collectTunnels = () => __awaiter(void 0, void 0, void 0, function* () {
    const entries = [];
    while (true) {
        const name = yield ask("📝 Enter a friendly name for this tunnel: ");
        const url = yield ask("🔗 Enter the full target URL: ");
        try {
            const parsed = new url_1.URL(url);
            entries.push({ FriendlyName: name, URL: parsed.href });
        }
        catch (_a) {
            console.log(chalk_1.default.red("❌ Invalid URL, skipping this entry"));
        }
        const addMore = yield askYesNo("➕ Add another tunnel?");
        if (!addMore)
            break;
    }
    return entries;
});
const displayTunnelList = () => {
    console.log(chalk_1.default.cyan("\n📋 Active Tunnels:"));
    activeTunnels
        .sort((a, b) => a.index - b.index)
        .forEach((tunnel) => {
        console.log(`  [${tunnel.index}] ${tunnel.friendlyName}: ${tunnel.publicUrl}`);
    });
};
const setupClipboardShortcuts = () => {
    activeTunnels.sort((a, b) => a.index - b.index);
    displayTunnelList();
    console.log(chalk_1.default.yellow("\n⌨️  Press a number (1, 2, 3, ...) to copy a tunnel URL to clipboard. Press Ctrl+C to exit.\n"));
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (key) => {
        //@ts-ignore
        const num = parseInt(key);
        if (!isNaN(num)) {
            const tunnel = activeTunnels.find((t) => t.index === num);
            if (tunnel) {
                clipboardy_1.default.writeSync(tunnel.publicUrl);
                console.log(chalk_1.default.magenta(`📋 Copied ${tunnel.friendlyName} URL to clipboard: ${tunnel.publicUrl}`));
            }
            else {
                console.log(chalk_1.default.red(`❌ No tunnel found for index ${num}`));
            }
        }
        //@ts-ignore
        if (key === "\u0003") {
            console.log(chalk_1.default.gray("\n👋 Exiting..."));
            process.exit();
        }
    });
};
const main = () => __awaiter(void 0, void 0, void 0, function* () {
    (0, logger_1.cleanOldLogs)();
    const tunnelURL = yield getTunnelURL();
    const entries = yield collectTunnels();
    if (!entries.length) {
        const logMsg = chalk_1.default.red("❌ No tunnels defined. Exiting.");
        console.log(logMsg);
        (0, logger_1.log)(logMsg);
        rl.close();
        return;
    }
    const logMsg = chalk_1.default.blue("\n🚀 Starting tunnel(s)...\n");
    console.log(logMsg);
    (0, logger_1.log)(logMsg);
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        yield startTunnel(tunnelURL, entry.URL, entry.FriendlyName, i + 1);
    }
    rl.close();
    setupClipboardShortcuts();
});
main();
