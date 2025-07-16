const { execSync } = require("child_process")
const path = require("path")
const dotenv = require("dotenv")
dotenv.config()

const appName = process.env.APP_NAME ?? "BENgrok-client"

const nodeVersion = `node${process.env.NODE_VERSION ?? 18}`

const targets = [
  "linux-x64",
  "win-x64",
  "macos-x64"
]

targets.forEach(target => {
  const fullTarget = `${nodeVersion}-${target}`
  const outputPath = path.join("build", `${appName}-${target}${target.includes("win") ? ".exe" : ""}`)
  const cmd = `pkg . --targets ${fullTarget} --output ${outputPath}`
  console.log(`Building: ${cmd}`)
  execSync(cmd, { stdio: "inherit" })
})
