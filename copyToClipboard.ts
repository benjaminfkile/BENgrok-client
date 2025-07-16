import os from "os";
import { exec } from "child_process";

const copyToClipboard = (text: string) => {
  const platform = os.platform();

  if (platform === "win32") {
    exec(`echo ${text} | clip`);
  } else if (platform === "darwin") {
    exec(`echo "${text.replace(/"/g, '\\"')}" | pbcopy`);
  } else {
    exec(`echo "${text.replace(/"/g, '\\"')}" | xclip -selection clipboard`);
  }
};

export default copyToClipboard;
