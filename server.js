const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = __dirname;
const port = Number(process.env.PORT || 8765);
const host = process.env.HOST || "0.0.0.0";

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
fs.mkdirSync(path.join(root, "data", "audio"), { recursive: true });

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
  const data = apiMode === "responses"
    ? await requestByResponsesAPI(config, char)
    : await requestByChatCompletionsAPI(config, char);

  log(`AI 已返回：${char}，开始校验字段`);
  validateGeneratedData(data, char);
  const savedItem = saveCardData(data);
  log(`保存完成：data/${savedItem.file}，字表已更新`);
  sendJSON(response, 200, { data, item: savedItem });
}

function serveStatic(request, response) {
  const urlPath = decodeURIComponent(new URL(request.url, `http://${host}:${port}`).pathname);
  if (urlPath === "/config/openai-config.json") {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("配置文件只允许本地服务读取");
    return;
  }
  const safePath = path.normalize(urlPath === "/" ? "/index.html" : urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(root, safePath);
  if (!filePath.startsWith(root)) {
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
  const configPath = path.join(root, "config", "openai-config.json");
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

function readTTSConfig() {
  const configPath = path.join(root, "config", "tts-config.json");
  if (!fs.existsSync(configPath)) return null;
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

function getAudioHash(text, speaker, params) {
  const hashInput = [text, speaker, params.format, String(params.sample_rate), String(params.speech_rate)].join("|");
  return crypto.createHash("sha256").update(hashInput).digest("hex").slice(0, 16);
}

async function handleTTS(request, response) {
  const body = await readBody(request);
  const { text, speaker: reqSpeaker } = JSON.parse(body || "{}");
  if (!text || typeof text !== "string") {
    sendJSON(response, 400, { success: false, error: "缺少 text 参数" });
    return;
  }

  const config = readTTSConfig();
  if (!config || !config.appId || !config.accessKey) {
    sendJSON(response, 200, { success: false, error: "TTS 配置缺失", fallback: true });
    return;
  }

  const speaker = reqSpeaker || config.speaker || "zh_female_xiaoyi_meitu";
  const audioParams = config.audioParams || { format: "mp3", sample_rate: 24000, speech_rate: 0 };
  const hash = getAudioHash(text, speaker, audioParams);
  const audioFile = `${hash}.${audioParams.format || "mp3"}`;
  const audioPath = path.join(root, "data", "audio", audioFile);

  if (fs.existsSync(audioPath)) {
    sendJSON(response, 200, { success: true, audioUrl: `/data/audio/${audioFile}`, cached: true });
    return;
  }

  try {
    log(`TTS 提交任务：${text.slice(0, 30)}...`);
    const submitRes = await submitTTSTask(config, text, speaker, audioParams);
    if (submitRes.code !== 20000000) {
      throw new Error(submitRes.message || `TTS 提交失败（code ${submitRes.code}）`);
    }
    const taskId = submitRes.data.task_id;

    const queryRes = await pollTTSTask(config, taskId);
    if (queryRes.code !== 20000000 || queryRes.data.task_status !== 2) {
      throw new Error(queryRes.message || `TTS 合成失败（status ${queryRes.data?.task_status}）`);
    }

    const audioUrl = queryRes.data.audio_url;
    if (!audioUrl) {
      throw new Error("TTS 响应缺少音频地址");
    }

    await downloadAudio(audioUrl, audioPath);
    log(`TTS 音频已保存：data/audio/${audioFile}`);
    sendJSON(response, 200, { success: true, audioUrl: `/data/audio/${audioFile}`, cached: false });
  } catch (error) {
    log(`TTS 失败：${error.message}`);
    sendJSON(response, 200, { success: false, error: error.message, fallback: true });
  }
}

function submitTTSTask(config, text, speaker, audioParams) {
  const payload = JSON.stringify({
    user: { uid: "hanzi-card-user" },
    unique_id: `tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    namespace: config.namespace || "BidirectionalTTS",
    req_params: {
      text,
      speaker,
      audio_params: {
        format: audioParams.format || "mp3",
        sample_rate: audioParams.sample_rate || 24000,
        speech_rate: audioParams.speech_rate ?? 0
      }
    }
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      method: "POST",
      hostname: "openspeech.bytedance.com",
      path: "/api/v3/tts/unidirectional",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "X-Api-Key": config.accessKey,
        "X-Api-Resource-Id": config.resourceId || "seed-tts-2.0",
        "X-Api-Request-Id": `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      }
    }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => raw += chunk);
      res.on("end", () => {
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch {
          resolve({ code: -1, message: raw });
        }
      });
    });
    req.on("error", (error) => reject(new Error(`TTS 提交请求失败：${error.message}`)));
    req.write(payload);
    req.end();
  });
}

function queryTTSTask(config, taskId) {
  const payload = JSON.stringify({ task_id: taskId });
  return new Promise((resolve, reject) => {
    const req = https.request({
      method: "POST",
      hostname: "openspeech.bytedance.com",
      path: "/api/v3/tts/query",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "X-Api-Key": config.accessKey,
        "X-Api-Resource-Id": config.resourceId || "seed-tts-2.0",
        "X-Api-Request-Id": `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      }
    }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => raw += chunk);
      res.on("end", () => {
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch {
          resolve({ code: -1, message: raw });
        }
      });
    });
    req.on("error", (error) => reject(new Error(`TTS 查询请求失败：${error.message}`)));
    req.write(payload);
    req.end();
  });
}

async function pollTTSTask(config, taskId) {
  const maxAttempts = 30;
  const interval = 2000;
  for (let i = 0; i < maxAttempts; i++) {
    const res = await queryTTSTask(config, taskId);
    if (res.code !== 20000000) {
      throw new Error(res.message || `TTS 查询失败（code ${res.code}）`);
    }
    const status = res.data?.task_status;
    if (status === 2) return res;
    if (status === 3) throw new Error("TTS 合成任务失败");
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error("TTS 合成超时，请稍后重试");
}

function downloadAudio(url, filePath) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = https.get({
      hostname: target.hostname,
      path: `${target.pathname}${target.search}`,
      port: target.port || 443
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadAudio(res.headers.location, filePath).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`下载音频失败（HTTP ${res.statusCode}）`));
        return;
      }
      const file = fs.createWriteStream(filePath);
      res.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
      file.on("error", (error) => {
        fs.unlink(filePath, () => {});
        reject(error);
      });
    });
    req.on("error", (error) => reject(new Error(`下载音频请求失败：${error.message}`)));
  });
}

function syncRegistryWithDataFiles() {
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const registry = readRegistry();
  const byChar = new Map((registry.items || []).map((item) => [item.char, item]));
  for (const file of fs.readdirSync(dataDir)) {
    if (!file.endsWith(".json") || file === "characters.json") continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf-8"));
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
  const registryPath = path.join(root, "data", "characters.json");
  if (!fs.existsSync(registryPath)) {
    return { version: 1, updated_at: today(), items: [] };
  }
  return JSON.parse(fs.readFileSync(registryPath, "utf-8"));
}

function writeRegistry(items) {
  const registryPath = path.join(root, "data", "characters.json");
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
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const file = `${data.char}_v5.json`;
  const filePath = path.join(dataDir, file);
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
    input: `请为汉字“${char}”生成一份完整 JSON。只输出 JSON，不要 Markdown。`,
    text: { format: { type: "json_object" } }
  };
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
      { role: "user", content: `请为汉字“${char}”生成一份完整 JSON。只输出 JSON，不要 Markdown。` }
    ]
  };
  const result = await postJSON(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, config.apiKey, payload, "Chat Completions API");
  const text = result.choices?.[0]?.message?.content;
  if (!text) throw new Error("接口没有返回可解析文本");
  return parseJSONText(text);
}

function postJSON(url, apiKey, payload, apiName) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const body = JSON.stringify(payload);
    log(`${apiName} 发送请求：${target.hostname}${target.pathname}`);
    const req = https.request({
      method: "POST",
      hostname: target.hostname,
      path: `${target.pathname}${target.search}`,
      port: target.port || 443,
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
    req.on("error", (error) => reject(new Error(`${apiName} 请求失败：${error.message}`)));
    req.write(body);
    req.end();
  });
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
