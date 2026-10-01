const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");

const root = path.join(__dirname, "..");
const coversDir = path.join(root, "covers");

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "Localify-Desktop-Cover-Sync" } }, res => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error("HTTP " + res.statusCode));
        return;
      }
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    }).on("error", reject);
  });
}

async function main() {
  fs.mkdirSync(coversDir, { recursive: true });

  const api = "https://api.github.com/repos/blibbbye/Localify/contents/covers?ref=main";
  const listing = JSON.parse((await get(api)).toString("utf8"));

  for (const item of listing.filter(x => x.type === "file" && x.download_url)) {
    const file = path.join(coversDir, item.name);
    fs.writeFileSync(file, await get(item.download_url));
    console.log("synced", item.name);
  }

  const map = await get("https://raw.githubusercontent.com/blibbbye/Localify/main/covers.json");
  fs.writeFileSync(path.join(root, "covers.json"), map);

  console.log("Localify cover system synced.");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
