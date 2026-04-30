const state = {
  list: [],
  filteredList: [],
  selectedFile: "",
  currentData: null,
  generatedData: null,
  writer: null,
  batchResult: null,
  dialogMode: "add"
};

const elements = {
  search: document.getElementById("characterSearch"),
  list: document.getElementById("characterList"),
  page: document.getElementById("cardPage"),
  loadStatus: document.getElementById("loadStatus"),
  input: document.getElementById("newCharInput"),
  openAddDialogButton: document.getElementById("openAddDialogButton"),
  openBatchAudioDialogButton: document.getElementById("openBatchAudioDialogButton"),
  confirmDialog: document.getElementById("confirmDialog"),
  confirmTitle: document.getElementById("confirmTitle"),
  confirmMessage: document.getElementById("confirmMessage"),
  cancelGenerateButton: document.getElementById("cancelGenerateButton"),
  confirmGenerateButton: document.getElementById("confirmGenerateButton"),
  addInputGroup: document.getElementById("addInputGroup"),
  audioOptionsGroup: document.getElementById("audioOptionsGroup"),
  loadingOverlay: document.getElementById("loadingOverlay"),
  loadingTitle: document.getElementById("loadingTitle"),
  loadingDescription: document.getElementById("loadingDescription"),
  loadingProgressFill: document.getElementById("loadingProgressFill"),
  loadingProgressText: document.getElementById("loadingProgressText"),
  loadingProgressList: document.getElementById("loadingProgressList")
};

const AUDIO_BATCH_TYPE_OPTIONS = [
  { key: "character", label: "单字读音" },
  { key: "story", label: "字源故事" },
  { key: "reading", label: "字词句" }
];

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
  elements.openBatchAudioDialogButton.addEventListener("click", openBatchAudioDialog);
  elements.cancelGenerateButton.addEventListener("click", hideConfirmDialog);
}

function openAddCharacterDialog() {
  state.dialogMode = "add";
  elements.input.value = "";
  setAudioBatchSelections(AUDIO_BATCH_TYPE_OPTIONS.map((item) => item.key));
  showConfirmDialog({
    title: "新增字卡",
    message: "可一次输入多个汉字，系统会自动提取汉字、跳过已存在项，并按顺序批量生成。",
    confirmText: "开始新增",
    showInput: true,
    onConfirm: prepareGenerateCharacters
  });
  setTimeout(() => elements.input.focus(), 0);
}

function openBatchAudioDialog() {
  state.dialogMode = "audio";
  elements.input.value = "";
  setAudioBatchSelections(AUDIO_BATCH_TYPE_OPTIONS.map((item) => item.key));
  showConfirmDialog({
    title: "批量生成语音",
    message: "留空会为全部已有字卡生成语音；输入汉字则只处理指定字。可勾选要生成的内容类型。",
    confirmText: "开始生成",
    showInput: true,
    showAudioOptions: true,
    onConfirm: prepareBatchAudioGeneration
  });
  setTimeout(() => elements.input.focus(), 0);
}

function prepareGenerateCharacters() {
  const parsed = parseBatchCharacters(elements.input.value);
  if (parsed.allChars.length === 0) {
    showConfirmDialog({
      title: "新增字卡",
      message: "请输入至少一个汉字。",
      confirmText: "继续填写",
      showInput: true,
      onConfirm: prepareGenerateCharacters
    });
    setTimeout(() => elements.input.focus(), 0);
    return;
  }

  if (parsed.newChars.length === 0) {
    showConfirmDialog({
      title: "没有可新增的字",
      message: `共识别出 ${parsed.allChars.length} 个汉字，但它们都已经存在于字卡列表中。`,
      confirmText: "知道了",
      showInput: false,
      onConfirm: async () => {}
    });
    return;
  }

  showConfirmDialog({
    title: "确认新增",
    message: buildBatchConfirmMessage(parsed),
    confirmText: `生成 ${parsed.newChars.length} 个字`,
    showInput: false,
    onConfirm: () => generateCharactersByAI(parsed.newChars)
  });
}

function prepareBatchAudioGeneration() {
  const selectedTypes = getSelectedAudioBatchTypes();
  if (selectedTypes.length === 0) {
    showConfirmDialog({
      title: "批量生成语音",
      message: "请至少勾选一种要生成的语音内容。",
      confirmText: "继续设置",
      showInput: true,
      showAudioOptions: true,
      onConfirm: prepareBatchAudioGeneration
    });
    return;
  }

  const parsed = parseAudioBatchCharacters(elements.input.value);
  if (parsed.targetItems.length === 0) {
    showConfirmDialog({
      title: "批量生成语音",
      message: parsed.missingChars.length > 0
        ? `没有匹配到可生成的字卡。未找到：${parsed.missingChars.join("、")}。`
        : "当前还没有可生成语音的字卡。",
      confirmText: "知道了",
      showInput: false,
      onConfirm: async () => {}
    });
    return;
  }

  showConfirmDialog({
    title: "确认批量生成语音",
    message: buildBatchAudioConfirmMessage(parsed, selectedTypes),
    confirmText: `生成 ${parsed.targetItems.length * selectedTypes.length} 条语音`,
    showInput: false,
    onConfirm: () => generateBatchAudioFiles(parsed.targetItems, selectedTypes)
  });
}

function showConfirmDialog({ title, message, confirmText, showInput = false, showAudioOptions = false, onConfirm }) {
  elements.confirmTitle.textContent = title;
  elements.confirmMessage.textContent = message;
  elements.confirmGenerateButton.textContent = confirmText;
  elements.addInputGroup.hidden = !showInput;
  elements.audioOptionsGroup.hidden = !showAudioOptions;
  elements.confirmGenerateButton.onclick = async () => {
    hideConfirmDialog();
    await onConfirm();
  };
  elements.confirmDialog.hidden = false;
}

function hideConfirmDialog() {
  elements.confirmDialog.hidden = true;
}

function getSelectedAudioBatchTypes() {
  return Array.from(document.querySelectorAll('input[name="audioBatchType"]:checked'))
    .map((input) => input.value)
    .filter((value) => AUDIO_BATCH_TYPE_OPTIONS.some((item) => item.key === value));
}

function setAudioBatchSelections(selectedTypes) {
  const selected = new Set(selectedTypes);
  document.querySelectorAll('input[name="audioBatchType"]').forEach((input) => {
    input.checked = selected.has(input.value);
  });
}

function setLoading(isLoading) {
  elements.loadingOverlay.hidden = !isLoading;
}

function updateLoadingProgress(progress = {}) {
  const total = Number(progress.total || 0);
  const current = Number(progress.current || 0);
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  const success = Number(progress.success || 0);
  const failed = Number(progress.failed || 0);
  const skipped = Number(progress.skipped || 0);
  const currentChar = progress.currentChar ? `当前：${progress.currentChar}` : "等待开始";
  const details = [`成功 ${success}`];
  if (failed > 0) details.push(`失败 ${failed}`);
  if (skipped > 0) details.push(`跳过 ${skipped}`);

  elements.loadingTitle.textContent = progress.title || "AI 生成中，请稍候";
  elements.loadingDescription.textContent = progress.description || "正在整理字源、字族、词句和亲子互动。";
  elements.loadingProgressFill.style.width = `${percent}%`;
  elements.loadingProgressText.textContent = total > 0
    ? `${currentChar} · ${current}/${total} · ${details.join(" · ")}`
    : "等待开始";

  const items = progress.items || [];
  elements.loadingProgressList.innerHTML = items.map((item) => `
    <li class="loading-progress-item ${escapeAttr(item.status || "")}">
      <span>${escapeHtml(item.char || "")}</span>
      <span>${escapeHtml(item.label || "")}</span>
    </li>
  `).join("");
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
    const response = await fetch(`data/cards/${file}`, { cache: "no-store" });
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
  const audioPayloads = buildCardAudioPayloads(data);
  const characterAudio = audioPayloads.character;
  const storyAudio = audioPayloads.story;
  const readingAudio = audioPayloads.reading;

  elements.page.innerHTML = `
    <section class="hero">
      <div class="hero-main">
        <div class="hero-char-row">
          <div class="big-char">${escapeHtml(data.char)}</div>
          ${ttsButtonHTML(characterAudio.text, "大字读音", "hero-tts-button", characterAudio)}
        </div>
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
      <h2>字源故事${ttsButtonHTML(storyAudio.text, "字源故事", "", storyAudio)}</h2>
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
      <h2>字 → 词 → 句${ttsButtonHTML(readingAudio.text, "字词句", "", readingAudio)}</h2>
      <div class="ladder">
        <div><span class="tag">字</span><span>${escapeHtml(reading.char || data.char)}</span></div>
        <div><span class="tag">词</span><span>${escapeHtml((reading.words || []).join("、"))}</span></div>
        ${(reading.sentences || []).map((sentence) => `<div><span class="tag">句</span><span>${escapeHtml(sentence)}</span></div>`).join("")}
      </div>
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

function ttsButtonHTML(text, label, extraClass = "", options = {}) {
  const buttonClass = ["tts-button", extraClass].filter(Boolean).join(" ");
  const audioKey = escapeAttr(options.audioKey || "");
  const audioSlug = escapeAttr(options.audioSlug || "");
  const textType = escapeAttr(options.textType || "");
  const ssmlText = escapeAttr(options.ssmlText || "");
  return `<button class="${buttonClass}" type="button" data-text="${escapeAttr(text)}" data-audio-key="${audioKey}" data-audio-slug="${audioSlug}" data-text-type="${textType}" data-ssml-text="${ssmlText}" title="朗读${label ? "：" + label : ""}" aria-label="朗读${label ? "：" + label : ""}">
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
  </button>`;
}

async function playTTS(text, button) {
  if (!text) return;
  if (button) button.classList.add("playing");

  try {
    const result = await requestTTSFile({
      text,
      audioKey: button?.dataset.audioKey || "",
      audioSlug: button?.dataset.audioSlug || "",
      textType: button?.dataset.textType || "",
      ssmlText: button?.dataset.ssmlText || ""
    });
    const audio = new Audio(result.audioUrl);
    audio.onended = () => { if (button) button.classList.remove("playing"); };
    audio.onerror = () => {
      if (button) button.classList.remove("playing");
      speak(text);
    };
    await audio.play();
  } catch (error) {
    if (button) button.classList.remove("playing");
    speak(text);
  }
}

async function generateCharacterByAI(char) {
  elements.openAddDialogButton.disabled = true;
  setLoading(true);
  updateLoadingProgress({
    total: 1,
    current: 0,
    currentChar: char,
    title: "AI 生成中，请稍候",
    description: "正在整理字源、字族、词句和亲子互动。",
    items: [{ char, status: "working", label: "等待生成" }]
  });

  try {
    const config = await loadRuntimeAIConfig();
    const { data } = await generateSingleCharacter(char, config);
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

async function generateCharactersByAI(chars) {
  elements.openAddDialogButton.disabled = true;
  setLoading(true);

  const progressItems = chars.map((char) => ({ char, status: "pending", label: "等待生成" }));
  const updateBatchProgress = (extra = {}) => {
    updateLoadingProgress({
      total: chars.length,
      current: extra.current ?? 0,
      currentChar: extra.currentChar || "",
      success: extra.success ?? 0,
      failed: extra.failed ?? 0,
      skipped: extra.skipped ?? 0,
      title: "批量生成中，请稍候",
      description: "系统会按顺序逐个生成字卡，并在完成后自动刷新列表。",
      items: progressItems
    });
  };

  let success = 0;
  let failed = 0;
  const successChars = [];
  const failedItems = [];
  updateBatchProgress();

  try {
    const config = await loadRuntimeAIConfig();
    for (let index = 0; index < chars.length; index++) {
      const char = chars[index];
      progressItems[index] = { char, status: "working", label: "生成中" };
      updateBatchProgress({
        current: index,
        currentChar: char,
        success,
        failed
      });

      try {
        const { data } = await generateSingleCharacter(char, config);
        validateGeneratedData(data, char);
        progressItems[index] = { char, status: "success", label: "已完成" };
        success += 1;
        successChars.push(char);
      } catch (error) {
        progressItems[index] = { char, status: "failed", label: error.message || "生成失败" };
        failed += 1;
        failedItems.push({ char, message: error.message || "生成失败" });
      }

      updateBatchProgress({
        current: index + 1,
        currentChar: char,
        success,
        failed
      });
    }

    await loadCharacterList();
    if (successChars.length > 0) {
      const savedChar = successChars[successChars.length - 1];
      const savedItem = state.list.find((item) => item.char === savedChar);
      if (savedItem) {
        await loadSelectedCharacter(savedItem.file);
      }
    }

    showInfoDialog(
      "批量新增完成",
      buildBatchResultMessage(chars.length, success, failed, failedItems)
    );
  } finally {
    setLoading(false);
    elements.openAddDialogButton.disabled = false;
  }
}

async function generateSingleCharacter(char, config) {
  const data = await requestHanziCard(config, char);
  return { data };
}

async function loadRuntimeAIConfig() {
  return location.protocol === "file:" ? await loadOpenAIConfig() : {};
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

function parseBatchCharacters(value) {
  const matches = String(value || "").match(/\p{Script=Han}/gu) || [];
  const allChars = [];
  for (const char of matches) {
    if (!allChars.includes(char)) allChars.push(char);
  }
  const existingChars = allChars.filter((char) => state.list.some((item) => item.char === char));
  const newChars = allChars.filter((char) => !existingChars.includes(char));
  return { allChars, newChars, existingChars };
}

function buildBatchConfirmMessage(parsed) {
  const parts = [
    `共识别出 ${parsed.allChars.length} 个汉字。`,
    `准备新增 ${parsed.newChars.length} 个。`
  ];
  if (parsed.existingChars.length > 0) {
    parts.push(`将跳过已存在的 ${parsed.existingChars.length} 个：${parsed.existingChars.join("、")}。`);
  }
  parts.push(`本次新增：${parsed.newChars.join("、")}。`);
  return parts.join("");
}

function buildBatchResultMessage(total, success, failed, failedItems) {
  const parts = [`共处理 ${total} 个汉字，成功 ${success} 个。`];
  if (failed > 0) {
    const detail = failedItems
      .slice(0, 3)
      .map((item) => `${item.char}：${item.message}`)
      .join("；");
    parts.push(`失败 ${failed} 个。${detail}`);
  }
  return parts.join("");
}

function parseAudioBatchCharacters(value) {
  const requestedChars = parseBatchCharacters(value).allChars;
  if (requestedChars.length === 0) {
    return {
      targetItems: [...state.list],
      missingChars: [],
      requestedChars: [],
      usedAll: true
    };
  }

  const targetItems = [];
  const missingChars = [];
  for (const char of requestedChars) {
    const matched = state.list.find((item) => item.char === char);
    if (matched) {
      targetItems.push(matched);
    } else {
      missingChars.push(char);
    }
  }

  return {
    targetItems,
    missingChars,
    requestedChars,
    usedAll: false
  };
}

function buildBatchAudioConfirmMessage(parsed, selectedTypes) {
  const typeLabels = selectedTypes.map(getAudioBatchTypeLabel);
  const parts = [
    parsed.usedAll
      ? `将为全部 ${parsed.targetItems.length} 张已有字卡生成语音。`
      : `将为 ${parsed.targetItems.length} 个字生成语音：${parsed.targetItems.map((item) => item.char).join("、")}。`,
    `生成内容：${typeLabels.join("、")}。`
  ];
  if (parsed.missingChars.length > 0) {
    parts.push(`以下字卡未找到，已跳过：${parsed.missingChars.join("、")}。`);
  }
  return parts.join("");
}

function getAudioBatchTypeLabel(type) {
  return AUDIO_BATCH_TYPE_OPTIONS.find((item) => item.key === type)?.label || type;
}

function buildCardAudioPayloads(data) {
  const relations = data.character_relations || {};
  const reading = data.reading_context || {};
  const recording = data.recording_ladder || {};
  const pronunciationExamples = collectPronunciationExamples(
    data.char,
    reading.words || [],
    recording.word || "",
    (relations.word_family || []).map((item) => item.word || "")
  );
  const characterSpeechText = buildCharacterSpeechText(data.char, data.pinyin, pronunciationExamples);
  const readingSpeechText = [
    characterSpeechText,
    ...(reading.words || []),
    ...(reading.sentences || [])
  ].filter(Boolean).join("。");

  return {
    character: {
      text: characterSpeechText,
      audioKey: "character",
      audioSlug: buildAudioSlug(data.char, data.pinyin, "character"),
      textType: "ssml",
      ssmlText: buildCharacterSpeechSSML(data.char, data.pinyin, pronunciationExamples)
    },
    story: {
      text: data.child_story || "",
      audioKey: "story",
      audioSlug: buildAudioSlug(data.char, data.pinyin, "story")
    },
    reading: {
      text: readingSpeechText,
      audioKey: "reading",
      audioSlug: buildAudioSlug(data.char, data.pinyin, "reading")
    }
  };
}

async function loadCharacterData(file) {
  const response = await fetch(`data/${file}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`字卡数据读取失败：${file}`);
  return response.json();
}

async function requestTTSFile(payload) {
  const response = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || `TTS 请求失败：HTTP ${response.status}`);
  }
  if (!result.success) {
    throw new Error(result.error || "TTS 生成失败");
  }
  return result;
}

async function generateBatchAudioFiles(targetItems, selectedTypes) {
  elements.openBatchAudioDialogButton.disabled = true;
  elements.openAddDialogButton.disabled = true;
  setLoading(true);

  const tasks = [];
  for (const item of targetItems) {
    const data = await loadCharacterData(item.file);
    const payloads = buildCardAudioPayloads(data);
    for (const type of selectedTypes) {
      const payload = payloads[type];
      if (!payload?.text) continue;
      tasks.push({
        char: data.char,
        type,
        label: getAudioBatchTypeLabel(type),
        payload
      });
    }
  }

  const progressItems = tasks.map((task) => ({
    char: task.char,
    status: "pending",
    label: task.label
  }));

  const updateAudioProgress = (extra = {}) => {
    updateLoadingProgress({
      total: tasks.length,
      current: extra.current ?? 0,
      currentChar: extra.currentChar || "",
      success: extra.success ?? 0,
      failed: extra.failed ?? 0,
      skipped: extra.skipped ?? 0,
      title: "批量生成语音中，请稍候",
      description: "系统会顺序调用本地 TTS 接口，字卡数据来自 data/cards，音频缓存写入 data/audio。",
      items: progressItems.slice(Math.max(0, (extra.current ?? 0) - 6), Math.max(8, extra.current ?? 0))
    });
  };

  let success = 0;
  let failed = 0;
  let cached = 0;
  const failedItems = [];
  updateAudioProgress();

  try {
    for (let index = 0; index < tasks.length; index++) {
      const task = tasks[index];
      progressItems[index] = {
        char: task.char,
        status: "working",
        label: `${task.label} 生成中`
      };
      updateAudioProgress({
        current: index,
        currentChar: `${task.char} · ${task.label}`,
        success,
        failed
      });

      try {
        const result = await requestTTSFile(task.payload);
        if (result.cached) cached += 1;
        success += 1;
        progressItems[index] = {
          char: task.char,
          status: "success",
          label: result.cached ? `${task.label} 已缓存` : `${task.label} 已生成`
        };
      } catch (error) {
        failed += 1;
        failedItems.push({ char: task.char, label: task.label, message: error.message || "生成失败" });
        progressItems[index] = {
          char: task.char,
          status: "failed",
          label: `${task.label} 失败`
        };
      }

      updateAudioProgress({
        current: index + 1,
        currentChar: `${task.char} · ${task.label}`,
        success,
        failed
      });
    }

    const summary = [`共处理 ${tasks.length} 条语音，成功 ${success} 条。`];
    if (cached > 0) summary.push(`其中命中缓存 ${cached} 条。`);
    if (failedItems.length > 0) {
      summary.push(`失败 ${failedItems.length} 条：${failedItems.slice(0, 3).map((item) => `${item.char}·${item.label}：${item.message}`).join("；")}`);
    }
    showInfoDialog("批量语音生成完成", summary.join(""));
  } finally {
    setLoading(false);
    elements.openBatchAudioDialogButton.disabled = false;
    elements.openAddDialogButton.disabled = false;
  }
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

function buildCharacterSpeechText(char, pinyin, examples = []) {
  const parts = splitPinyinSyllable(pinyin || "");
  const tone = getPinyinToneName(pinyin || "");
  return [
    parts.initialPhoneme ? `声母 ${getInitialTeachingSpeech(parts.initialPhoneme)}` : "这个字没有声母",
    parts.finalPhoneme ? `韵母 ${getFinalTeachingSpeech(parts.finalPhoneme)}` : "",
    tone ? `声调 ${tone}` : "",
    parts.fullDisplay ? `完整拼音 ${parts.fullDisplay}` : "",
    ...examples.slice(0, 2)
  ].filter(Boolean).join("。");
}

function buildCharacterSpeechSSML(char, pinyin, examples = []) {
  const parts = splitPinyinSyllable(pinyin || "");
  const tone = getPinyinToneName(pinyin || "");
  const escapedExamples = examples
    .slice(0, 2)
    .map((item) => escapeSSMLText(item))
    .join("，");

  const sections = ["<speak>"];
  if (parts.initialPhoneme) {
    sections.push(`声母 ${escapeSSMLText(getInitialTeachingSpeech(parts.initialPhoneme))}，`);
  } else {
    sections.push("这个字没有声母，");
  }
  if (parts.finalPhoneme) {
    sections.push(`韵母 ${escapeSSMLText(getFinalTeachingSpeech(parts.finalPhoneme))}，`);
  }
  if (tone) {
    sections.push(`声调 <break time="200ms"/> ${escapeSSMLText(tone)}，`);
  }
  if (parts.fullDisplay && parts.fullPhoneme) {
    sections.push(`完整拼音 <phoneme alphabet="py" ph="${escapeSSMLAttr(parts.fullPhoneme)}">${escapeSSMLText(char)}</phoneme>。`);
  }
  if (escapedExamples) {
    sections.push('<break time="500ms"/>');
    sections.push(`${escapedExamples}。`);
  }
  sections.push("</speak>");
  return sections.join("");
}

function getPinyinToneNumber(pinyin) {
  const value = String(pinyin || "");
  return value.match(/[1-5]/)?.[0];
}

function getPinyinToneName(pinyin) {
  const value = String(pinyin || "");
  const toneNumber = getPinyinToneNumber(pinyin);
  if (toneNumber) {
    return ["一声", "二声", "三声", "四声", "轻声"][Number(toneNumber) - 1];
  }
  const toneMarks = [
    { pattern: /[āēīōūǖ]/, name: "一声" },
    { pattern: /[áéíóúǘ]/, name: "二声" },
    { pattern: /[ǎěǐǒǔǚ]/, name: "三声" },
    { pattern: /[àèìòùǜ]/, name: "四声" }
  ];
  return toneMarks.find((tone) => tone.pattern.test(value))?.name || "";
}

function getInitialTeachingSpeech(initial) {
  const map = {
    b: "玻",
    p: "坡",
    m: "摸",
    f: "佛",
    d: "得",
    t: "特",
    n: "讷",
    l: "勒",
    g: "哥",
    k: "科",
    h: "喝",
    j: "鸡",
    q: "七",
    x: "西",
    zh: "知",
    ch: "吃",
    sh: "诗",
    r: "日",
    z: "资",
    c: "呲",
    s: "思",
    y: "衣",
    w: "乌"
  };
  return map[initial] || initial;
}

function getFinalTeachingSpeech(final) {
  const map = {
    a: "啊",
    o: "喔",
    e: "鹅",
    i: "衣",
    u: "乌",
    v: "迂",
    ai: "哀",
    ei: "诶",
    ao: "凹",
    ou: "欧",
    an: "安",
    en: "恩",
    ang: "昂",
    eng: "鞥",
    ong: "翁",
    er: "儿",
    ia: "呀",
    ie: "耶",
    iao: "腰",
    iu: "优",
    ian: "烟",
    in: "音",
    iang: "央",
    ing: "英",
    iong: "雍",
    ua: "蛙",
    uo: "窝",
    uai: "歪",
    ui: "威",
    uan: "弯",
    un: "温",
    uang: "汪",
    ueng: "翁",
    ve: "约",
    van: "冤",
    vn: "晕"
  };
  return map[final] || formatPinyinDisplay(final);
}

function collectPronunciationExamples(char, words, preferredWord, relatedWords) {
  const pool = [preferredWord, ...words, ...relatedWords]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item) => item.includes(char));

  const unique = [];
  for (const word of pool) {
    if (!unique.includes(word)) unique.push(word);
  }

  return unique.sort((a, b) => {
    const aStarts = a.startsWith(char) ? 0 : 1;
    const bStarts = b.startsWith(char) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    if (a.length !== b.length) return a.length - b.length;
    return a.localeCompare(b, "zh-Hans-CN");
  });
}

function buildAudioSlug(char, pinyin, audioKey) {
  if (audioKey === "character") {
    return String(char || "").trim() || "character";
  }
  const slug = stripToneMarks(String(pinyin || ""))
    .toLowerCase()
    .replaceAll("ü", "v")
    .replace(/\s+/g, "");
  return slug || String(char || "").trim() || "audio";
}

function splitPinyinSyllable(pinyin) {
  const normalized = normalizePinyinForSpeech(pinyin);
  const fullDisplay = formatPinyinDisplay(pinyin);
  const fullPhoneme = toToneNumberPinyin(pinyin);
  if (!normalized) {
    return {
      initialDisplay: "",
      initialPhoneme: "",
      finalDisplay: "",
      finalPhoneme: "",
      fullDisplay,
      fullPhoneme
    };
  }

  let initial = "";
  let final = normalized;

  if (normalized.startsWith("yu")) {
    initial = "y";
    final = `v${normalized.slice(2)}`;
  } else if (normalized.startsWith("y")) {
    initial = "y";
    final = normalized.slice(1);
  } else if (normalized.startsWith("w")) {
    initial = "w";
    final = normalized.slice(1) || "u";
  } else {
    const initials = ["zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "r", "z", "c", "s"];
    for (const candidate of initials) {
      if (normalized.startsWith(candidate)) {
        initial = candidate;
        final = normalized.slice(candidate.length);
        break;
      }
    }
  }

  return {
    initialDisplay: formatPinyinDisplay(initial),
    initialPhoneme: initial,
    finalDisplay: formatPinyinDisplay(final),
    finalPhoneme: final,
    fullDisplay,
    fullPhoneme
  };
}

function normalizePinyinForSpeech(value) {
  return normalizePinyinLetters(value).replace(/[1-5]/g, "");
}

function normalizePinyinLetters(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[āáǎà]/g, "a")
    .replace(/[ēéěè]/g, "e")
    .replace(/[īíǐì]/g, "i")
    .replace(/[ōóǒò]/g, "o")
    .replace(/[ūúǔù]/g, "u")
    .replace(/[ǖǘǚǜü]/g, "v");
}

function toToneNumberPinyin(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  const explicitTone = text.match(/[1-5]/)?.[0];
  const normalized = normalizePinyinLetters(text);
  if (explicitTone) {
    return `${normalized}${explicitTone}`;
  }

  const toneMap = [
    { pattern: /[āēīōūǖ]/, tone: "1" },
    { pattern: /[áéíóúǘ]/, tone: "2" },
    { pattern: /[ǎěǐǒǔǚ]/, tone: "3" },
    { pattern: /[àèìòùǜ]/, tone: "4" }
  ];
  const matched = toneMap.find((item) => item.pattern.test(text));
  return matched ? `${normalized}${matched.tone}` : normalized;
}

function formatPinyinDisplay(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replaceAll("v", "ü");
}

function escapeSSMLText(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeSSMLAttr(value) {
  return escapeSSMLText(value)
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
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
