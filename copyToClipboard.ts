import os from "os"
import { exec } from "child_process"

const copyToClipboard = (text: string) => {
  const platform = os.platform()
  const cleanText = text.trim()

  if (platform === "win32") {
    exec(`echo|set /p="${cleanText}" | clip`)
  } else if (platform === "darwin") {
    exec(`printf "%s" "${cleanText.replace(/"/g, '\\"')}" | pbcopy`)
  } else {
    exec(`printf "%s" "${cleanText.replace(/"/g, '\\"')}" | xclip -selection clipboard`)
  }
}

export default copyToClipboard
