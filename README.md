# 🕳️ BENGrok Tunnel Client

This is a lightweight Node.js-based tunnel client that connects to a central WebSocket tunnel server and forwards local traffic over the internet. It's similar to [ngrok](https://ngrok.com), but custom-built.

## 🚧 Prerequisites

Make sure you have the following installed:

- [Node.js](https://nodejs.org/) (v16+ recommended)
- [npm](https://www.npmjs.com/) (comes with Node.js)

## 📦 Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/your-org/ben-grok-client.git
   cd ben-grok-client
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Optionally, make the client globally accessible (for dev use only):
   ```bash
   npm link
   ```

## 🚀 Usage

To start the tunnel client:

```bash
npm start
```

You'll be prompted with:

- The **tunnel server URL** (only once — it’s saved to a `tunnel_url.txt` file)
- One or more **local ports** to expose (e.g. `3000,4000`)
- (Optional) A custom `Host` header to pass in the forwarded HTTP request

Example:

```bash
🔁 Use saved tunnel URL (https://your-tunnel-server.com)? (Y/n): Y
🔌 Enter port(s) to expose (comma-separated): 3000
🌐 Optional: custom Host header (blank for localhost): 
```

After starting, you’ll see tunnel details like:

```
✅ Tunnel Ready: https://your-tunnel-server.com/tunnel/abc12345 → localhost:3000
```

This means public requests to `/tunnel/abc12345/*` on the tunnel server will forward to your local service.

## 🧹 Cleaning Up

If you want to reset the saved tunnel server URL:

```bash
rm tunnel_url.txt
```

Or simply run the client and type `n` when prompted to re-enter a new one.

## 📁 Logs

Tunnel logs are saved to the `logs/` directory. Old logs (10+ days) are deleted automatically.

## 🛠️ Dev Mode

To run in watch mode with auto-rebuild on file changes:

```bash
npm run dev
```

## 🔧 Build

Build the app manually:

```bash
npm run build
```

## 📝 License

MIT