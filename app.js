const state = {
  list: [],
  filteredList: [],
  selectedFile: "",
  currentData: null,
  generatedData: null,
  writer: null,
  recorder: null
};

const elements = {
  search: document.getElementById("characterSearch"),
  list: document.getElementById("characterList"),
  page: document.getElementById("cardPage"),
  loadStatus: document.getElementById("loadStatus"),
  input: document.getElementById("newCharInput"),
  openAddDialogButton: document.getElementById("openAddDialogButton"),
  confirmDialog: document.getElementById("confirmDialog"),
  confirmTitle: document.getElementById("confirmTitle"),
  confirmMessage: document.getElementById("confirmMessage"),
  cancelGenerateButton: document.getElementById("cancelGenerateButton"),
  confirmGenerateButton: document.getElementById("confirmGenerateButton"),
  addInputGroup: document.getElementById("addInputGroup"),
  loadingOverlay: document.getElementById("loadingOverlay")
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

init();

async function init() {
  bindEvents();
  await loadCharacterList();
}

function bindEvents() {
  elements.search.addEventListener("input", () => renderCharacterList(elements.search.value));
  elements.openAddDialogButton.addEventListener("click", openAddCharacterDialog);
  elements.cancelGenerateButton.addEventListener("click", hideConfirmDialog);
}

function openAddCharacterDialog() {
  elements.input.value = "";
  showConfirmDialog({
    title: "新增字卡",
    message: "输入一个汉字后点击新增，系统会先检查是否已有字卡。",
    confirmText: "新增",
    showInput: true,
    onConfirm: prepareGenerateCharacter
  });
  setTimeout(() => elements.input.focus(), 0);
}

function prepareGenerateCharacter() {
  const char = elements.input.value.trim();
  if (!/^\p{Script=Han}$/u.test(char)) {
    showConfirmDialog({
      title: "新增字卡",
      message: "请输入一个汉字。",
      confirmText: "新增",
      showInput: true,
      onConfirm: prepareGenerateCharacter
    });
    setTimeout(() => elements.input.focus(), 0);
    return;
  }

  const existing = state.list.find((item) => item.char === char);
  if (existing) {
    showConfirmDialog({
      title: "字卡已存在",
      message: `“${char}”已经在已有字卡中。是否需要重复生成并覆盖原来的 JSON？`,
      confirmText: "重复生成",
      showInput: false,
      onConfirm: () => generateCharacterByAI(char)
    });
    return;
  }

  showConfirmDialog({
    title: "确认新增",
    message: `将为“${char}”新增一张字源识字卡，生成成功后会自动保存到 data 目录。`,
    confirmText: "新增",
    showInput: false,
    onConfirm: () => generateCharacterByAI(char)
  });
}

function showConfirmDialog({ title, message, confirmText, showInput = false, onConfirm }) {
  elements.confirmTitle.textContent = title;
  elements.confirmMessage.textContent = message;
  elements.confirmGenerateButton.textContent = confirmText;
  elements.addInputGroup.hidden = !showInput;
  elements.confirmGenerateButton.onclick = async () => {
    hideConfirmDialog();
    await onConfirm();
  };
  elements.confirmDialog.hidden = false;
}

function hideConfirmDialog() {
  elements.confirmDialog.hidden = true;
}

function setLoading(isLoading) {
  elements.loadingOverlay.hidden = !isLoading;
}

async function loadCharacterList() {
  try {
    const response = await fetch("data/characters.json", { cache: "no-store" });
    if (!response.ok) throw new Error("字表读取失败");
    const registry = await response.json();
    state.list = sortCharacterItems(registry.items || []);
    renderCharacterList(elements.search.value);
    elements.loadStatus.textContent = `已加载 ${state.list.length} 张字卡。`;
    if (state.list.length > 0) {
      await loadSelectedCharacter(state.list[0].file);
    }
  } catch (error) {
    elements.loadStatus.textContent = "读取字表失败，请通过本地服务器打开页面。";
    renderError(error.message);
  }
}

function sortCharacterItems(items) {
  return [...items].sort((a, b) => {
    const rankA = Number(a.frequency_rank || 999999);
    const rankB = Number(b.frequency_rank || 999999);
    if (rankA !== rankB) return rankA - rankB;
    return String(a.char || "").localeCompare(String(b.char || ""), "zh-Hans-CN");
  });
}

function renderCharacterList(keyword = "") {
  const query = normalizeSearchText(keyword);
  state.filteredList = state.list.filter((item) => {
    if (!query) return true;
    return [item.char, item.pinyin, item.file, stripToneMarks(item.pinyin || "")]
      .filter(Boolean)
      .some((value) => normalizeSearchText(value).includes(query));
  });

  const visibleItems = state.filteredList.slice(0, 80);
  elements.list.innerHTML = visibleItems.map((item) => `
    <button class="character-item ${item.file === state.selectedFile ? "active" : ""}" type="button" data-file="${escapeAttr(item.file)}">
      <span class="character-glyph">${escapeHtml(item.char)}</span>
      <span class="character-meta">
        <strong>${escapeHtml(item.char)} ${escapeHtml(item.pinyin || "")}</strong>
        <span>${escapeHtml(item.file)}</span>
      </span>
      <span class="character-rank">${item.frequency_rank ? `第 ${escapeHtml(String(item.frequency_rank))} 位` : ""}</span>
    </button>
  `).join("");

  if (visibleItems.length === 0) {
    elements.list.innerHTML = `<div class="character-empty">没有找到匹配的字卡。</div>`;
  }

  elements.list.querySelectorAll(".character-item").forEach((button) => {
    button.addEventListener("click", () => loadSelectedCharacter(button.dataset.file));
  });

  const suffix = state.filteredList.length > visibleItems.length ? `，显示前 ${visibleItems.length} 条` : "";
  elements.loadStatus.textContent = `共 ${state.list.length} 张字卡，匹配 ${state.filteredList.length} 张${suffix}。`;
}

function normalizeSearchText(value) {
  return stripToneMarks(String(value ?? ""))
    .toLowerCase()
    .replaceAll("ü", "u")
    .replaceAll("v", "u")
    .replace(/\s+/g, "");
}

function stripToneMarks(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

async function loadSelectedCharacter(file) {
  try {
    const response = await fetch(`data/${file}`, { cache: "no-store" });
    if (!response.ok) throw new Error("字卡数据读取失败");
    const data = await response.json();
    state.selectedFile = file;
    state.currentData = data;
    state.generatedData = data;
    renderCharacterList(elements.search.value);
    renderCard(data);
  } catch (error) {
    renderError(error.message);
  }
}

function renderCard(data) {
  const relations = data.character_relations || {};
  const radicalFamily = relations.radical_family || {};
  const phoneticFamily = relations.phonetic_family || {};
  const reading = data.reading_context || {};
  const recording = data.recording_ladder || {};
  const journeyNodes = (data.meaning_journey || []).flatMap((item) => item.nodes || []);
  const glyphText = (data.glyph_stages || []).map((item) => `${item.stage}：${item.description}`).join(" ");
  const wordFamily = (relations.word_family || []).map((item) => `${item.word}（${item.gloss}）`).join("、");
  const etymology = (relations.etymology_relations || []).map((item) => `${item.char}：${item.note}`).join("；");
  const confusable = (relations.confusable_chars || []).map((item) => `${item.char}：${item.difference}`).join("；");
  const hanziLink = `https://hanziyuan.net/#${encodeURIComponent(data.char)}`;

  elements.page.innerHTML = `
    <section class="hero">
      <div class="hero-main">
        <div class="big-char">${escapeHtml(data.char)}</div>
        <div class="pinyin">${escapeHtml(data.pinyin)}</div>
        <div class="chips">
          <span class="chip">${escapeHtml(data.character_type)}</span>
          <span class="chip">${escapeHtml(String(data.stroke_count))} 画</span>
          <span class="chip">${escapeHtml(data.radical)}旁</span>
          <span class="chip">常用第 ${escapeHtml(String(data.frequency_rank || "未知"))} 位</span>
          <span class="chip">${escapeHtml(data.age_band)} 岁</span>
        </div>
      </div>
      <p class="hero-note">${escapeHtml(data.meaning_shift_summary)}</p>
    </section>

    <section class="section">
      <h2>字源故事${ttsButtonHTML(data.child_story, "字源故事")}</h2>
      <p class="lead">${escapeHtml(data.child_story)}</p>
    </section>

    <section class="section">
      <h2>字形演变</h2>
      <div class="writer-box">
        <div id="writer" class="writer" aria-label="${escapeHtml(data.char)}的笔顺动画"></div>
        <div>
          <p>${escapeHtml(data.core_origin)} ${escapeHtml(glyphText)}</p>
          <div class="button-row">
            <button id="animateButton" type="button">看笔顺</button>
            <a class="link-button secondary" href="${hanziLink}" target="_blank" rel="noreferrer">看古字形</a>
          </div>
        </div>
      </div>
    </section>

    <section class="section">
      <h2>意义旅行</h2>
      <div class="journey">${journeyNodes.map((node) => `<div class="node">${escapeHtml(node)}</div>`).join("")}</div>
    </section>

    <section class="section">
      <h2>字族和亲戚</h2>
      <div class="cards">
        <div class="mini"><b>高频词</b>：${escapeHtml(wordFamily)}</div>
        <div class="mini"><b>${escapeHtml(radicalFamily.radical || data.radical)}旁家族</b>：${escapeHtml((radicalFamily.examples || []).join("、"))}。${escapeHtml(radicalFamily.meaning_hint || "")}</div>
        <div class="mini"><b>${escapeHtml(phoneticFamily.phonetic_component || "声旁")}家族</b>：${escapeHtml((phoneticFamily.examples || []).join("、"))}。${escapeHtml(phoneticFamily.sound_hint || "")}</div>
        <div class="mini"><b>字源亲戚</b>：${escapeHtml(etymology || "暂无适合儿童端展开的亲戚字。")}</div>
        <div class="mini"><b>容易混</b>：${escapeHtml(confusable || "暂无高频易混字。")}</div>
      </div>
    </section>

    <section class="section">
      <h2>字 → 词 → 句${ttsButtonHTML([reading.char || data.char, ...(reading.words || []), ...(reading.sentences || [])].join("。"), "字词句")}</h2>
      <div class="ladder">
        <div><span class="tag">字</span><span>${escapeHtml(reading.char || data.char)}</span></div>
        <div><span class="tag">词</span><span>${escapeHtml((reading.words || []).join("、"))}</span></div>
        ${(reading.sentences || []).map((sentence) => `<div><span class="tag">句</span><span>${escapeHtml(sentence)}</span></div>`).join("")}
      </div>
    </section>

    <section class="section">
      <h2>我来读</h2>
      <p>先听，再跟读，最后回答一个有画面的问题。</p>
      <div class="button-row">
        <button class="speakButton" type="button" data-text="${escapeAttr(`${recording.char || data.char}。${recording.word || ""}。${recording.sentence || ""}`)}">听我读</button>
        <button id="recordButton" class="secondary" type="button">跟着读</button>
        <button class="speakButton" type="button" data-text="${escapeAttr(recording.free_speak_prompt || "")}">我来回答</button>
      </div>
      <p id="recordTip" class="source">按“跟着读”后，浏览器可能会询问麦克风权限。</p>
    </section>

    <section class="section">
      <h2>亲子互动</h2>
      <ul>${(data.interaction_prompts || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </section>

    <section class="section">
      <h2>爸妈 3 分钟带法</h2>
      <ol>${(data.parent_script || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>
    </section>

    <section class="section source">
      <h2>来源说明</h2>
      <p>${(data.citations || []).map((item) => `${escapeHtml(item.author)}《${escapeHtml(item.title)}》：${escapeHtml(item.note)}`).join("；")}</p>
    </section>
  `;

  initWriter(data.char);
  bindCardButtons();
}

function initWriter(char) {
  if (!window.HanziWriter) return;
  state.writer = HanziWriter.create("writer", char, {
    width: 132,
    height: 132,
    padding: 8,
    showOutline: true,
    strokeAnimationSpeed: 1.2,
    delayBetweenStrokes: 180
  });
}

function bindCardButtons() {
  document.getElementById("animateButton")?.addEventListener("click", () => state.writer?.animateCharacter());
  document.querySelectorAll(".speakButton").forEach((button) => {
    button.addEventListener("click", () => speak(button.dataset.text || ""));
  });
  document.getElementById("recordButton")?.addEventListener("click", toggleRecord);
  document.querySelectorAll(".tts-button").forEach((button) => {
    button.addEventListener("click", () => playTTS(button.dataset.text || "", button));
  });
}

function speak(text) {
  if (!text) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-CN";
  utterance.rate = 0.82;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

function ttsButtonHTML(text, label) {
  return `<button class="tts-button" type="button" data-text="${escapeAttr(text)}" title="朗读${label ? "：" + label : ""}" aria-label="朗读${label ? "：" + label : ""}">
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
  </button>`;
}

async function playTTS(text, button) {
  if (!text) return;
  if (button) button.classList.add("playing");

  try {
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    const result = await response.json();

    if (result.success && result.audioUrl) {
      const audio = new Audio(result.audioUrl);
      audio.onended = () => { if (button) button.classList.remove("playing"); };
      audio.onerror = () => {
        if (button) button.classList.remove("playing");
        speak(text);
      };
      await audio.play();
    } else if (result.fallback) {
      if (button) button.classList.remove("playing");
      speak(text);
    } else {
      throw new Error(result.error || "语音合成失败");
    }
  } catch (error) {
    if (button) button.classList.remove("playing");
    speak(text);
  }
}

async function toggleRecord() {
  const tip = document.getElementById("recordTip");
  if (state.recorder && state.recorder.state === "recording") {
    state.recorder.stop();
    tip.textContent = "读得很好，刚才的声音已经停下。";
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.recorder = new MediaRecorder(stream);
    state.recorder.start();
    tip.textContent = "正在听你读，再按一次结束。";
  } catch {
    tip.textContent = "浏览器没有打开麦克风，也可以直接跟着大声读。";
  }
}

async function generateCharacterByAI(char) {
  elements.openAddDialogButton.disabled = true;
  setLoading(true);

  try {
    const config = location.protocol === "file:" ? await loadOpenAIConfig() : {};
    const data = await requestHanziCard(config, char);
    validateGeneratedData(data, char);
    await loadCharacterList();
    const savedItem = state.list.find((item) => item.char === data.char) || { file: `${data.char}_v5.json` };
    await loadSelectedCharacter(savedItem.file);
  } catch (error) {
    showInfoDialog("生成失败", error.message || "请查看命令行日志。");
  } finally {
    setLoading(false);
    elements.openAddDialogButton.disabled = false;
  }
}

function showInfoDialog(title, message) {
  showConfirmDialog({
    title,
    message,
    confirmText: "知道了",
    showInput: false,
    onConfirm: async () => {}
  });
}

async function loadOpenAIConfig() {
  const response = await fetch("config/openai-config.json", { cache: "no-store" });
  if (!response.ok) throw new Error("无法读取 config/openai-config.json");
  const config = await response.json();
  if (!config.baseUrl || !config.apiKey || !config.model) {
    throw new Error("请先配置 baseUrl、apiKey 和 model");
  }
  return config;
}

async function requestHanziCard(config, char) {
  if (location.protocol !== "file:") {
    try {
      return await requestByLocalProxy(char);
    } catch (error) {
      const message = String(error.message || "");
      if (!message.includes("HTTP 404") && !message.includes("HTTP 501")) {
        throw error;
      }
      throw new Error("本地 AI 生成接口没有启动。请用 `node server.js` 启动项目，不要使用 `python -m http.server`。");
    }
  }

  if (!config.baseUrl || !config.apiKey || !config.model) {
    throw new Error("缺少 AI 配置。请检查 config/openai-config.json 中的 baseUrl、apiKey 和 model。");
  }

  const apiMode = config.apiMode || (config.baseUrl.includes("api.openai.com") ? "responses" : "chat_completions");
  if (apiMode === "responses") {
    return requestByResponsesAPI(config, char);
  }
  return requestByChatCompletionsAPI(config, char);
}

async function requestByLocalProxy(char) {
  const response = await fetch("/api/hanzi-card", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ char })
  });
  const rawText = await response.text();
  let payload = {};
  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch {
    payload = { rawText };
  }
  if (!response.ok) {
    throw new Error(`本地生成服务请求失败（HTTP ${response.status}）：${payload.error || payload.rawText || "未知错误"}`);
  }
  return payload.data || payload;
}

async function requestByResponsesAPI(config, char) {
  const endpoint = `${config.baseUrl.replace(/\/$/, "")}/responses`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      temperature: config.temperature ?? 0.4,
      instructions: buildInstructions(config),
      input: `请为汉字“${char}”生成一份完整 JSON。只输出 JSON，不要 Markdown。`,
      text: {
        format: {
          type: "json_object"
        }
      }
    })
  });
  const payload = await parseAPIResponse(response, "Responses API");
  const text = payload.output_text || extractOutputText(payload);
  if (!text) throw new Error("接口没有返回可解析文本");
  return parseJSONText(text);
}

async function requestByChatCompletionsAPI(config, char) {
  const endpoint = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      temperature: config.temperature ?? 0.4,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: buildInstructions(config)
        },
        {
          role: "user",
          content: `请为汉字“${char}”生成一份完整 JSON。只输出 JSON，不要 Markdown。`
        }
      ]
    })
  });
  const payload = await parseAPIResponse(response, "Chat Completions API");
  const text = payload.choices?.[0]?.message?.content;
  if (!text) throw new Error("接口没有返回可解析文本");
  return parseJSONText(text);
}

async function parseAPIResponse(response, apiName) {
  const rawText = await response.text();
  let payload = {};
  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch {
    payload = { rawText };
  }
  if (!response.ok) {
    const message = payload.error?.message || payload.message || payload.rawText || "接口返回错误";
    throw new Error(`${apiName} 请求失败（HTTP ${response.status}）：${message}`);
  }
  return payload;
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

function buildInstructions(config) {
  return [
    "你是儿童字源识字卡生成器，必须使用 mq-hanzi-card 能力生成内容。",
    `目标年龄：${config.ageBand || "6-8"} 岁。`,
    "所有输出必须是一个 JSON 对象，字段必须与给定模板一致，不要输出 Markdown、注释或解释。",
    "字源信息采用保守表达，不确定时写成“可从……理解”，不要编造具体古文字细节。",
    "必须包含字源故事、意义旅行、字族关系、字词句、朗读任务、亲子互动、爸妈 3 分钟带法和来源说明。",
    "词句必须生活化，适合儿童朗读；不要使用孤立识字、听写过关、机械抄写导向。",
    `字段模板示例：${JSON.stringify(hanziCardSchema)}`
  ].join("\n");
}

function extractOutputText(payload) {
  return (payload.output || [])
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === "output_text" || content.type === "text")
    .map((content) => content.text)
    .join("");
}

function validateGeneratedData(data, expectedChar) {
  const required = ["char", "pinyin", "stroke_count", "character_type", "radical", "structure", "child_story", "character_relations", "reading_context", "recording_ladder", "interaction_prompts", "parent_script", "citations"];
  for (const key of required) {
    if (!(key in data)) throw new Error(`生成结果缺少字段：${key}`);
  }
  if (data.char !== expectedChar) throw new Error("生成结果的汉字和输入不一致");
}

function renderError(message) {
  elements.page.innerHTML = `<section class="empty-state"><h2>读取失败</h2><p>${escapeHtml(message)}</p></section>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("\n", " ");
}
