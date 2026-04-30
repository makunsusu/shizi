const fs = require("fs");
const path = require("path");
const https = require("https");

const root = path.resolve(__dirname, "..");
const dataDir = path.join(root, "data");
const cardsDir = path.join(dataDir, "cards");
const registryPath = path.join(dataDir, "characters.json");
const localFrequencyPath = path.join(dataDir, "hanzi-frequency-rank.csv");
const frequencyUrl = "https://raw.githubusercontent.com/ruddfawcett/hanziDB.csv/master/hanzi_db.csv";

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`下载字频表失败：HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => raw += chunk);
      res.on("end", () => resolve(raw));
    }).on("error", reject);
  });
}

function parseFrequencyMap(csvText) {
  const map = new Map();
  const lines = csvText.split(/\r?\n/);
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    const firstComma = line.indexOf(",");
    const secondComma = line.indexOf(",", firstComma + 1);
    if (firstComma < 0 || secondComma < 0) continue;
    const rank = Number(line.slice(0, firstComma));
    const char = line.slice(firstComma + 1, secondComma);
    if (char && Number.isFinite(rank)) {
      map.set(char, rank);
    }
  }
  return map;
}

async function loadFrequencyCsv() {
  if (fs.existsSync(localFrequencyPath)) {
    return fs.readFileSync(localFrequencyPath, "utf8");
  }
  const csvText = await fetchText(frequencyUrl);
  fs.writeFileSync(localFrequencyPath, csvText, "utf8");
  return csvText;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function sortRegistryItems(items) {
  return [...items].sort((a, b) => {
    const rankA = Number(a.frequency_rank || 999999);
    const rankB = Number(b.frequency_rank || 999999);
    if (rankA !== rankB) return rankA - rankB;
    return String(a.char || "").localeCompare(String(b.char || ""), "zh-Hans-CN");
  });
}

async function main() {
  const csvText = await loadFrequencyCsv();
  const frequencyMap = parseFrequencyMap(csvText);

  const files = fs.readdirSync(cardsDir)
    .filter((file) => file.endsWith(".json"));

  let updatedCards = 0;
  let untouchedCards = 0;
  const changed = [];

  for (const file of files) {
    const filePath = path.join(cardsDir, file);
    const data = readJson(filePath);
    if (!data.char) {
      untouchedCards += 1;
      continue;
    }
    const nextRank = Number(frequencyMap.get(data.char) || 0);
    const prevRank = Number(data.frequency_rank || 0);
    if (prevRank !== nextRank) {
      data.frequency_rank = nextRank;
      writeJson(filePath, data);
      updatedCards += 1;
      changed.push({ char: data.char, file, prevRank, nextRank });
    } else {
      untouchedCards += 1;
    }
  }

  const registry = readJson(registryPath);
  const nextItems = (registry.items || []).map((item) => ({
    ...item,
    frequency_rank: Number(frequencyMap.get(item.char) || 0)
  }));
  registry.items = sortRegistryItems(nextItems);
  registry.updated_at = new Date().toISOString().slice(0, 10);
  writeJson(registryPath, registry);

  console.log(JSON.stringify({
    updatedCards,
    untouchedCards,
    sample: changed.slice(0, 10)
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
