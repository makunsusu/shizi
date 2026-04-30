const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = __dirname;
const port = Number(process.env.PORT || 8765);
const host = process.env.HOST || "0.0.0.0";
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
const configDir = path.resolve(process.env.CONFIG_DIR || path.join(root, "config"));
const cardsDir = path.join(dataDir, "cards");
const audioDir = path.join(dataDir, "audio");
const registryPath = path.join(dataDir, "characters.json");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".mp3": "audio/mpeg"
};

const hanziCardSchema = {
  char: "",
  pinyin: "",
  stroke_count: 0,
  character_type: "",
  radical: "",
  structure: "",
  age_band: "6-8",
  frequency_rank: 0,
  core_origin: "",
  original_meaning: "",
  meaning_shift_summary: "",
  child_story: "",
  glyph_stages: [{ stage: "", era: "", description: "" }],
  meaning_journey: [{ label: "", nodes: ["", "", ""] }],
  character_relations: {
    word_family: [{ word: "", gloss: "" }],
    radical_family: { radical: "", meaning_hint: "", examples: ["", "", ""] },
    phonetic_family: { phonetic_component: "", sound_hint: "", examples: ["", "", ""] },
    etymology_relations: [{ char: "", relation: "", note: "" }],
    confusable_chars: [{ char: "", difference: "" }]
  },
  reading_context: { char: "", words: ["", "", ""], sentences: ["", "", ""] },
  recording_ladder: { char: "", word: "", sentence: "", free_speak_prompt: "" },
  interaction_prompts: ["", "", ""],
  parent_script: ["", "", "", ""],
  citations: [{ type: "", title: "", author: "", note: "" }]
};

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/api/health") {
      handleHealth(response);
      return;
    }
    if (request.method === "POST" && request.url === "/api/hanzi-card") {
      await handleHanziCard(request, response);
      return;
    }
    if (request.method === "POST" && request.url === "/api/tts") {
      await handleTTS(request, response);
      return;
    }
    serveStatic(request, response);
  } catch (error) {
    sendJSON(response, 500, { error: error.message || "本地服务处理失败" });
  }
});

syncRegistryWithDataFiles();
fs.mkdirSync(cardsDir, { recursive: true });
fs.mkdirSync(audioDir, { recursive: true });
fs.mkdirSync(path.dirname(registryPath), { recursive: true });

server.listen(port, host, () => {
  log(`字源识字卡服务已启动：http://${host}:${port}/index.html`);
});

async function handleHanziCard(request, response) {
  const body = await readBody(request);
  const { char } = JSON.parse(body || "{}");
  if (!/^\p{Script=Han}$/u.test(char || "")) {
    sendJSON(response, 400, { error: "请输入一个汉字" });
    return;
  }

  log(`收到生成请求：${char}`);
  const config = readConfig();
  if (!config.baseUrl || !config.apiKey || !config.model) {
    sendJSON(response, 400, { error: "请先配置 baseUrl、apiKey 和 model" });
    return;
  }

  const apiMode = config.apiMode || (config.baseUrl.includes("api.openai.com") ? "responses" : "chat_completions");
  log(`使用模型：${config.model}，接口模式：${apiMode}`);
  const data = await requestValidatedHanziCard(config, char, apiMode);
  const savedItem = saveCardData(data);
  log(`保存完成：data/cards/${savedItem.file}，字表已更新`);
  sendJSON(response, 200, { data, item: savedItem });
}

function serveStatic(request, response) {
  const urlPath = decodeURIComponent(new URL(request.url, `http://${host}:${port}`).pathname);
  if (urlPath === "/favicon.ico") {
    response.writeHead(204);
    response.end();
    return;
  }
  if (urlPath === "/config/openai-config.json" || urlPath === "/config/tts-config.json") {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("配置文件只允许本地服务读取");
    return;
  }
  const requestPath = urlPath === "/" ? "/index.html" : urlPath;
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const isDataRequest = safePath === `${path.sep}data` || safePath.startsWith(`${path.sep}data${path.sep}`);
  const staticRoot = isDataRequest ? dataDir : root;
  const relativePath = isDataRequest
    ? safePath.replace(new RegExp(`^\\${path.sep}data`), "") || path.sep
    : safePath;
  const filePath = path.join(staticRoot, relativePath);
  if (!filePath.startsWith(staticRoot)) {
    response.writeHead(403);
    response.end("禁止访问");
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("文件不存在");
      return;
    }
    response.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
    response.end(content);
  });
}

function readConfig() {
  const configPath = path.join(configDir, "openai-config.json");
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

function readTTSConfig() {
  const configPath = path.join(configDir, "tts-config.json");
  if (!fs.existsSync(configPath)) return null;
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

function getAudioHash(text, speaker, params, textType = "plain") {
  const hashInput = [textType, text, speaker, params.format, String(params.sample_rate), String(params.speech_rate)].join("|");
  return crypto.createHash("sha256").update(hashInput).digest("hex").slice(0, 16);
}

function normalizeAudioToken(value, fallback = "audio") {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\p{Script=Han}a-z0-9_-]+/gu, "")
    .replace(/^_+|_+$/g, "");
  return cleaned || fallback;
}

function buildAudioFileName(hash, params, meta = {}) {
  const format = params.format || "mp3";
  const audioKey = normalizeAudioToken(meta.audioKey, "audio");
  const audioSlug = normalizeAudioToken(meta.audioSlug, "audio");
  return `${audioSlug}_${audioKey}_${hash}.${format}`;
}

function findExistingAudioFileByHash(hash, format) {
  const exactLegacy = `${hash}.${format}`;
  const exactLegacyPath = path.join(audioDir, exactLegacy);
  if (fs.existsSync(exactLegacyPath)) {
    return exactLegacy;
  }

  const suffix = `_${hash}.${format}`;
  for (const file of fs.readdirSync(audioDir)) {
    if (file.endsWith(suffix)) {
      return file;
    }
  }
  return null;
}

async function handleTTS(request, response) {
  const body = await readBody(request);
  const { text, speaker: reqSpeaker, audioKey, audioSlug, textType, ssmlText } = JSON.parse(body || "{}");
  if (!text || typeof text !== "string") {
    sendJSON(response, 400, { success: false, error: "缺少 text 参数" });
    return;
  }

  const config = readTTSConfig();
  if (!config || !config.accessKey) {
    sendJSON(response, 200, { success: false, error: "TTS 配置缺失：请配置 accessKey", fallback: true });
    return;
  }

  const speaker = reqSpeaker || config.speaker || "zh_female_xiaoyi_meitu";
  const audioParams = config.audioParams || { format: "mp3", sample_rate: 24000, speech_rate: 0 };
  const normalizedTextType = textType === "ssml" && ssmlText ? "ssml" : "plain";
  const synthesisText = normalizedTextType === "ssml" ? ssmlText : text;
  const hash = getAudioHash(synthesisText, speaker, audioParams, normalizedTextType);
  const audioFile = buildAudioFileName(hash, audioParams, { audioKey, audioSlug });
  const audioPath = path.join(audioDir, audioFile);

  if (fs.existsSync(audioPath)) {
    sendJSON(response, 200, { success: true, audioUrl: `/data/audio/${audioFile}`, cached: true });
    return;
  }

  const existingFile = findExistingAudioFileByHash(hash, audioParams.format || "mp3");
  if (existingFile) {
    const existingPath = path.join(audioDir, existingFile);
    if (existingPath !== audioPath) {
      fs.renameSync(existingPath, audioPath);
      log(`TTS 缓存已迁移：data/audio/${existingFile} -> data/audio/${audioFile}`);
    }
    sendJSON(response, 200, { success: true, audioUrl: `/data/audio/${audioFile}`, cached: true });
    return;
  }

  try {
    log(`TTS 合成：${text.slice(0, 30)}...`);
    const audioBuffer = await requestTTSAudio(config, synthesisText, speaker, audioParams, normalizedTextType);
    fs.writeFileSync(audioPath, audioBuffer);
    log(`TTS 音频已保存：data/audio/${audioFile}`);
    sendJSON(response, 200, { success: true, audioUrl: `/data/audio/${audioFile}`, cached: false });
  } catch (error) {
    log(`TTS 失败：${error.message}`);
    sendJSON(response, 200, { success: false, error: error.message, fallback: true });
  }
}

function buildTTSHeaders(config, body, requestId) {
  const headers = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Connection": "keep-alive",
    "X-Api-Key": config.accessKey,
    "X-Api-Resource-Id": config.resourceId || "seed-tts-2.0",
    "X-Api-Request-Id": requestId
  };
  return headers;
}

function requestTTSAudio(config, text, speaker, audioParams, textType = "plain") {
  const payload = JSON.stringify({
    user: { uid: "hanzi-card-user" },
    req_params: {
      ssml: text,
      speaker,
      audio_params: {
        format: audioParams.format || "mp3",
        sample_rate: audioParams.sample_rate || 24000,
        speech_rate: audioParams.speech_rate ?? 0
      }
    }
  });
  log(payload)
  const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return new Promise((resolve, reject) => {
    const req = https.request({
      method: "POST",
      hostname: "openspeech.bytedance.com",
      path: "/api/v3/tts/unidirectional",
      headers: buildTTSHeaders(config, payload, requestId)
    }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => raw += chunk);
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`TTS 请求失败（HTTP ${res.statusCode}）：${raw || "无响应内容"}`));
          return;
        }
        try {
          const audioBuffer = parseTTSAudioStream(raw);
          resolve(audioBuffer);
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", (error) => reject(new Error(`TTS 请求失败：${error.message}`)));
    req.write(payload);
    req.end();
  });
}

function parseTTSAudioStream(raw) {
  const chunks = [];
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const jsonLine = line.startsWith("data:") ? line.slice(5).trim() : line;
    if (!jsonLine || jsonLine === "[DONE]") continue;
    let item;
    try {
      item = JSON.parse(jsonLine);
    } catch {
      continue;
    }
    if (item.code && item.code !== 0 && item.code !== 20000000) {
      throw new Error(item.message || `TTS 合成失败（code ${item.code}）`);
    }
    const audio = typeof item.data === "string" ? item.data : item.data?.audio;
    if (audio) {
      chunks.push(Buffer.from(audio, "base64"));
    }
  }
  if (chunks.length === 0) {
    throw new Error(raw || "TTS 响应中没有音频数据");
  }
  return Buffer.concat(chunks);
}

function syncRegistryWithDataFiles() {
  fs.mkdirSync(cardsDir, { recursive: true });
  const registry = readRegistry();
  const byChar = new Map((registry.items || []).map((item) => [item.char, item]));
  for (const file of fs.readdirSync(cardsDir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(cardsDir, file), "utf-8"));
      if (!data.char) continue;
      byChar.set(data.char, {
        char: data.char,
        pinyin: data.pinyin || "",
        file,
        frequency_rank: Number(data.frequency_rank || 0)
      });
    } catch (error) {
      log(`跳过无法读取的字卡：${file}，原因：${error.message}`);
    }
  }
  writeRegistry([...byChar.values()]);
  log(`字表同步完成：${byChar.size} 张字卡`);
}

function readRegistry() {
  if (!fs.existsSync(registryPath)) {
    return { version: 1, updated_at: today(), items: [] };
  }
  return JSON.parse(fs.readFileSync(registryPath, "utf-8"));
}

function writeRegistry(items) {
  const sortedItems = [...items].sort((a, b) => {
    const rankA = Number(a.frequency_rank || 999999);
    const rankB = Number(b.frequency_rank || 999999);
    if (rankA !== rankB) return rankA - rankB;
    return String(a.char || "").localeCompare(String(b.char || ""), "zh-Hans-CN");
  });
  const registry = {
    version: 1,
    updated_at: today(),
    items: sortedItems
  };
  fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf-8");
}

function saveCardData(data) {
  fs.mkdirSync(cardsDir, { recursive: true });
  const file = `${data.char}_v5.json`;
  const filePath = path.join(cardsDir, file);
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");

  const registry = readRegistry();
  const item = {
    char: data.char,
    pinyin: data.pinyin || "",
    file,
    frequency_rank: Number(data.frequency_rank || 0)
  };
  const items = (registry.items || []).filter((existing) => existing.char !== data.char);
  items.push(item);
  writeRegistry(items);
  return item;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("请求内容过大"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function requestByResponsesAPI(config, char) {
  log(`请求 Responses API：${char}`);
  const payload = {
    model: config.model,
    temperature: config.temperature ?? 0.4,
    instructions: buildInstructions(config),
    input: buildGenerationPrompt(char),
    text: { format: { type: "json_object" } }
  };
  applyProviderOptions(config, payload);
  const result = await postJSON(`${config.baseUrl.replace(/\/$/, "")}/responses`, config.apiKey, payload, "Responses API");
  const text = result.output_text || extractOutputText(result);
  if (!text) throw new Error("接口没有返回可解析文本");
  return parseJSONText(text);
}

async function requestByChatCompletionsAPI(config, char) {
  log(`请求 Chat Completions API：${char}`);
  const payload = {
    model: config.model,
    temperature: config.temperature ?? 0.4,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildInstructions(config) },
      { role: "user", content: buildGenerationPrompt(char) }
    ]
  };
  applyProviderOptions(config, payload);
  const result = await postJSON(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, config.apiKey, payload, "Chat Completions API");
  const text = result.choices?.[0]?.message?.content;
  if (!text) throw new Error("接口没有返回可解析文本");
  return parseJSONText(text);
}

async function requestValidatedHanziCard(config, char, apiMode) {
  const requestCard = apiMode === "responses"
    ? () => requestByResponsesAPI(config, char)
    : () => requestByChatCompletionsAPI(config, char);

  let lastError = null;
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startedAt = Date.now();
    try {
      const data = await requestCard();
      log(`AI 已返回：${char}，开始校验字段，第 ${attempt} 次耗时 ${Date.now() - startedAt}ms`);
      validateGeneratedData(data, char);
      return data;
    } catch (error) {
      lastError = error;
      log(`生成失败：${char}，第 ${attempt} 次，原因：${error.message}`);
      if (attempt >= maxAttempts) break;
      log(`准备重试：${char}，第 ${attempt + 1} 次`);
    }
  }
  throw lastError || new Error("生成失败");
}

function postJSON(url, apiKey, payload, apiName) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const body = JSON.stringify(payload);
    const timeoutMs = Number(payload.timeout_ms || payload.timeoutMs || 0) || 45000;
    log(`${apiName} 发送请求：${target.hostname}${target.pathname}，超时 ${timeoutMs}ms`);
    const req = https.request({
      method: "POST",
      hostname: target.hostname,
      path: `${target.pathname}${target.search}`,
      port: target.port || 443,
      timeout: timeoutMs,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "Authorization": `Bearer ${apiKey}`
      }
    }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => raw += chunk);
      res.on("end", () => {
        log(`${apiName} 收到响应：HTTP ${res.statusCode}`);
        let data = {};
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {
          data = { rawText: raw };
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const message = data.error?.message || data.message || data.rawText || "接口返回错误";
          reject(new Error(`${apiName} 请求失败（HTTP ${res.statusCode}）：${message}`));
          return;
        }
        resolve(data);
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error(`${apiName} 请求超时（>${timeoutMs}ms）`));
    });
    req.on("error", (error) => reject(new Error(`${apiName} 请求失败：${error.message}`)));
    req.write(body);
    req.end();
  });
}

function buildGenerationPrompt(char) {
  return [
    `请为汉字“${char}”生成一份完整 JSON。`,
    `输出中的 "char" 字段必须严格等于“${char}”。`,
    `所有拼音、词语、句子、字源说明都必须围绕“${char}”。`,
    "只输出 JSON，不要 Markdown，不要解释。"
  ].join("");
}

function applyProviderOptions(config, payload) {
  if (String(config.baseUrl || "").includes("api.deepseek.com")) {
    payload.max_tokens = Number(config.maxTokens || 3200);
    payload.thinking = { type: "disabled" };
  }
}

function buildInstructions(config) {
  const skillText = readProjectSkill();
  return [
    "你是儿童字源识字卡生成器，必须使用 mq-hanzi-card 能力生成内容。",
    `目标年龄：${config.ageBand || "6-8"} 岁。`,
    "所有输出必须是一个 JSON 对象，字段必须与给定模板一致，不要输出 Markdown、注释或解释。",
    "字源信息采用保守表达，不确定时写成“可从……理解”，不要编造具体古文字细节。",
    "必须包含字源故事、意义旅行、字族关系、字词句、朗读任务、亲子互动、爸妈 3 分钟带法和来源说明。",
    "词句必须生活化，适合儿童朗读；不要使用孤立识字、听写过关、机械抄写导向。",
    `项目内 mq-hanzi-card 技能说明：\n${skillText}`,
    `字段模板示例：${JSON.stringify(hanziCardSchema)}`
  ].join("\n");
}

function readProjectSkill() {
  const skillPath = path.join(root, "skills", "mq-hanzi-card.md");
  try {
    return fs.readFileSync(skillPath, "utf-8");
  } catch {
    return "项目内技能文件缺失，按内置字段模板生成。";
  }
}

function handleHealth(response) {
  sendJSON(response, 200, {
    ok: true,
    paths: {
      dataDir,
      configDir,
      cardsDir,
      audioDir,
      registryPath
    }
  });
}

function extractOutputText(payload) {
  return (payload.output || [])
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === "output_text" || content.type === "text")
    .map((content) => content.text)
    .join("");
}

function parseJSONText(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("接口返回内容不是有效 JSON");
  }
}

function validateGeneratedData(data, expectedChar) {
  const required = ["char", "pinyin", "stroke_count", "character_type", "radical", "structure", "child_story", "character_relations", "reading_context", "recording_ladder", "interaction_prompts", "parent_script", "citations"];
  for (const key of required) {
    if (!(key in data)) throw new Error(`生成结果缺少字段：${key}`);
  }
  if (data.char !== expectedChar) throw new Error("生成结果的汉字和输入不一致");
}

function sendJSON(response, statusCode, data) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function log(message) {
  const timestamp = new Date().toLocaleString("zh-CN", { hour12: false });
  console.log(`[${timestamp}] ${message}`);
}
