import fs from "fs"
import path from "path"
import os from "os"
import dotenv from "dotenv"

dotenv.config()

const APP_NAME = process.env.APP_NAME || "BENgrok"
const BASE_DIR = path.join(os.homedir(), APP_NAME)
const LOG_DIR = path.join(BASE_DIR, "logs")
const LOG_FILE = path.join(LOG_DIR, `log_${new Date().toISOString().slice(0, 10)}.log`)
const DAYS_TO_KEEP = 10

if (!fs.existsSync(BASE_DIR)) fs.mkdirSync(BASE_DIR)
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR)

export const log = (msg: string) => {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  fs.appendFileSync(LOG_FILE, line)
}

export const cleanOldLogs = () => {
  const files = fs.readdirSync(LOG_DIR)
  const now = Date.now()

  files.forEach(file => {
    const filePath = path.join(LOG_DIR, file)
    const stat = fs.statSync(filePath)
    const ageInDays = (now - stat.mtimeMs) / (1000 * 60 * 60 * 24)
    if (ageInDays > DAYS_TO_KEEP) fs.unlinkSync(filePath)
  })
}
