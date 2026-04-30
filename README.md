# 字源识字卡（shizi）

一个本地运行的儿童识字卡工具。

项目把 AI 生成、字卡浏览、TTS 朗读、音频缓存和字频补全放在了一起，适合持续积累自己的识字卡素材。

## 功能概览

- 浏览已有字卡
- 按汉字、拼音、文件名搜索字卡
- 批量新增字卡，由 AI 自动生成 JSON
- 首页大字、字源故事、字词句支持朗读
- 批量生成语音缓存
- 本地保存字卡与音频文件
- 用本地字频表批量补齐 `frequency_rank`

## 运行环境

- Node.js 18 或更高版本

## 快速开始

### 1. 配置 AI 生成

参考 [config/openai-config.example.json](d:/llm_projects/shizi/config/openai-config.example.json) 新建本地配置：

- `config/openai-config.json`

示例：

```json
{
  "baseUrl": "https://api.deepseek.com/v1",
  "apiKey": "你的 API Key",
  "model": "deepseek-v4-flash",
  "temperature": 0.4,
  "ageBand": "6-8"
}
```

### 2. 配置 TTS

参考 [config/tts-config.example.json](d:/llm_projects/shizi/config/tts-config.example.json) 新建本地配置：

- `config/tts-config.json`

示例：

```json
{
  "accessKey": "你的 TTS Access Key",
  "resourceId": "seed-tts-2.0",
  "speaker": "zh_female_vv_uranus_bigtts",
  "audioParams": {
    "format": "mp3",
    "sample_rate": 24000,
    "speech_rate": 0
  }
}
```

### 3. 启动项目

```bash
npm start
```

或

```bash
npm run dev
```

默认地址：

- `http://127.0.0.1:8765/index.html`

### 4. 语法检查

```bash
npm run check
```

## 页面功能

### 已有字卡

左侧可以：

- 浏览全部字卡
- 搜索汉字、拼音、文件名
- 切换当前展示字卡

### 新增字卡

点击“新增”后可以：

- 一次输入一个或多个汉字
- 自动提取汉字
- 自动跳过已经存在的字卡
- 按顺序批量生成
- 在加载层里查看生成进度

生成成功后会：

- 把字卡 JSON 保存到 `data/cards/`
- 更新字表索引 `data/characters.json`

### 批量语音

点击“批量语音”后可以：

- 留空输入框：为全部已有字卡生成语音
- 输入若干汉字：只为指定字卡生成语音
- 勾选要生成的内容类型：
  - 单字读音
  - 字源故事
  - 字词句

生成结果会缓存到：

- `data/audio/`

如果缓存文件被手动删除，再次点击朗读按钮时会自动重新生成。

## 目录结构

```text
shizi/
├─ app.js
├─ server.js
├─ index.html
├─ styles.css
├─ package.json
├─ config/
│  ├─ openai-config.example.json
│  ├─ openai-config.json        # 本地文件，已在 .gitignore 中忽略
│  ├─ tts-config.example.json
│  └─ tts-config.json           # 本地文件，已在 .gitignore 中忽略
├─ data/
│  ├─ cards/                    # 字卡 JSON
│  ├─ audio/                    # TTS 音频缓存
│  ├─ characters.json           # 字卡索引
│  └─ hanzi-frequency-rank.csv  # 本地字频表
└─ scripts/
   └─ fill-frequency-rank.js
```

## 数据文件说明

### `data/cards/*.json`

每个字一张卡，文件名格式类似：

- `语_v5.json`
- `红_v5.json`

### `data/characters.json`

字卡索引文件，前端列表和排序依赖它。

主要字段：

- `char`
- `pinyin`
- `file`
- `frequency_rank`

### `data/hanzi-frequency-rank.csv`

项目本地保存的汉字字频表。

目前 [scripts/fill-frequency-rank.js](d:/llm_projects/shizi/scripts/fill-frequency-rank.js) 会优先使用这份本地 CSV，不依赖外网。

## 字频补全脚本

如果你新增了一批字卡，想统一补齐或刷新 `frequency_rank`，可以运行：

```bash
node scripts/fill-frequency-rank.js
```

脚本会：

- 扫描 `data/cards/*.json`
- 按本地字频表回填 `frequency_rank`
- 同步更新 `data/characters.json`

## TTS 说明

### 当前朗读入口

页面里当前会使用服务端 TTS 的内容有：

- 首页大字读音
- 字源故事
- 字词句

### 单字读音

单字读音走 SSML，会带上：

- 声母
- 韵母
- 声调
- 完整拼音
- 两个示例词

### 音频命名

音频文件会带可读前缀，例如：

- `语_character_<hash>.mp3`
- `yu_story_<hash>.mp3`
- `yu_reading_<hash>.mp3`

## 常见操作

### 新增一个字卡

1. 启动 `node server.js`
2. 打开页面
3. 点击“新增”
4. 输入一个或多个汉字
5. 等待生成完成

### 批量预热语音缓存

1. 启动 `node server.js`
2. 打开页面
3. 点击“批量语音”
4. 选择生成内容
5. 留空或输入指定汉字
6. 等待批量完成

### 统一刷新字频排名

```bash
node scripts/fill-frequency-rank.js
```

## 注意事项

- 不要用 `python -m http.server` 直接替代本项目服务端，因为 AI 生成和 TTS 都依赖 [server.js](d:/llm_projects/shizi/server.js) 提供的本地接口。
- `config/openai-config.json` 和 `config/tts-config.json` 是本地私有配置，默认不提交。
- `data/audio/` 是缓存目录，默认不提交。
- 现在字卡 JSON 已经统一放到 `data/cards/`，不要再往 `data/` 根目录直接放卡片文件。

## 相关脚本

```bash
npm start      # 启动本地服务
npm run dev    # 启动本地服务
npm run check  # 语法检查
```
