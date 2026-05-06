# 字源识字卡（shizi）

一个本地运行的儿童识字卡工具，集成了：

- AI 生成字卡
- 已有字卡浏览与搜索
- TTS 朗读与音频缓存
- 本地字频补全
- 适合 NAS 常驻部署的数据落盘结构

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
- 如需部署到 NAS：Docker、Docker Compose、Jenkins、SSH、rsync

## 本地开发

### 1. 配置 AI 生成

参考 [config/openai-config.example.json](d:/llm_projects/shizi/config/openai-config.example.json) 新建：

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

参考 [config/tts-config.example.json](d:/llm_projects/shizi/config/tts-config.example.json) 新建：

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

或：

```bash
npm run dev
```

默认地址：

- `http://127.0.0.1:8765/index.html`

### 4. 语法检查

```bash
npm run check
```

### 5. 字频补全

```bash
node scripts/fill-frequency-rank.js
```

如果你在容器或 NAS 上使用挂载目录，也可以传入：

```bash
DATA_DIR=/你的数据目录 node scripts/fill-frequency-rank.js
```

## 目录结构

```text
shizi/
├─ app.js
├─ server.js
├─ index.html
├─ styles.css
├─ package.json
├─ Dockerfile
├─ docker-compose.yml
├─ Jenkinsfile
├─ config/
│  ├─ openai-config.example.json
│  ├─ openai-config.json        # 本地文件，默认忽略
│  ├─ tts-config.example.json
│  └─ tts-config.json           # 本地文件，默认忽略
├─ data/
│  ├─ cards/                    # 字卡 JSON
│  ├─ audio/                    # TTS 音频缓存
│  ├─ characters.json           # 字卡索引
│  └─ hanzi-frequency-rank.csv  # 本地字频表
├─ scripts/
│  └─ fill-frequency-rank.js
└─ skills/
   └─ mq-hanzi-card.md
```

## 环境变量

服务端现在支持以下运行时目录注入，方便容器挂载：

- `PORT`
  - 默认：`8765`
- `DATA_DIR`
  - 默认：`<repo>/data`
  - 用途：字卡、字表、音频缓存、字频表
- `CONFIG_DIR`
  - 默认：`<repo>/config`
  - 用途：`openai-config.json`、`tts-config.json`

健康检查接口：

- `GET /api/health`

返回内容会包含当前实际生效的 `dataDir`、`configDir` 等路径。

## 1Panel 部署

本项目已经补齐以下部署文件：

- [Dockerfile](d:/llm_projects/shizi/Dockerfile)
- [docker-compose.yml](d:/llm_projects/shizi/docker-compose.yml)
- [Jenkinsfile](d:/llm_projects/shizi/Jenkinsfile)

推荐的 NAS 目录规划：

```text
/vol3/@appdata/my_apps/shizi/
  repo/                                  # Git 仓库代码
/vol3/@appdata/my_apps/appdata/shizi/
  data/
    cards/                               # 持久化字卡
    audio/                               # 持久化音频缓存
    characters.json                      # 持久化字表索引
    hanzi-frequency-rank.csv             # 持久化字频表
  config/
    openai-config.json                   # AI 配置
    tts-config.json                      # TTS 配置
```

### 首次部署到 1Panel

1. SSH 登录 NAS。
2. 准备仓库目录：

```bash
mkdir -p /vol3/@appdata/my_apps/shizi
cd /vol3/@appdata/my_apps/shizi
git clone <你的仓库地址> repo
mkdir -p /vol3/@appdata/my_apps/appdata/shizi/data
mkdir -p /vol3/@appdata/my_apps/appdata/shizi/config
```

3. 进入项目目录，先复制配置模板：

```bash
cp config/openai-config.example.json /vol3/@appdata/my_apps/appdata/shizi/config/openai-config.json
cp config/tts-config.example.json /vol3/@appdata/my_apps/appdata/shizi/config/tts-config.json
```

4. 编辑 NAS 上的真实配置文件，填入你的 API Key。
5. 打开 1Panel，在“容器编排”中选择：

```text
/vol3/@appdata/my_apps/shizi/repo/docker-compose.yml
```

6. 启动编排后，默认访问地址：

```text
http://NAS_IP:18081/index.html
```

如果你要在 1Panel 里绑定域名，可以把反向代理目标写成：

```text
http://127.0.0.1:18081
```

### 手动升级

在 NAS 上执行：

```bash
cd /vol3/@appdata/my_apps/shizi/repo
git pull
docker compose up -d --build
docker image prune -f
```

### 编排说明

[docker-compose.yml](d:/llm_projects/shizi/docker-compose.yml) 默认会：

- 把 NAS 的 `.../appdata/shizi/data` 挂载到容器内 `/app/runtime/data`
- 把 NAS 的 `.../appdata/shizi/config` 挂载到容器内 `/app/runtime/config`
- 将外部端口 `18081` 映射到容器端口 `8765`
- 构建时默认使用 `mk-node:22-alpine` 作为基础镜像

## Jenkins 自动部署

本项目的 [Jenkinsfile](d:/llm_projects/shizi/Jenkinsfile) 参考了 `D:\llm_projects\aiManagerPrompter` 的做法，流程是：

1. Jenkins 从 Git 拉取代码
2. 通过 `rsync` 同步代码到 NAS 的 `repo/`
3. 在 NAS 上初始化持久化目录与配置模板
4. 执行 `docker compose up -d --build`
5. 调用 `/api/health` 做部署后验证

### Jenkins 凭据

Jenkins 里需要准备：

- `Credentials`
- `Credentials Binding`
- `SSH Credentials`
- `Pipeline`
- `Git`

并创建一条 SSH 私钥凭据，例如：

- 类型：`SSH Username with private key`
- ID：`fn-nas-ssh`
- Username：可登录 NAS 的用户
- Private Key：该用户的 SSH 私钥

### Jenkins 任务创建方式

1. `New Item`
2. 选择 `Pipeline`
3. `Pipeline script from SCM`
4. `SCM` 选择 `Git`
5. `Script Path` 填：

```text
Jenkinsfile
```

推荐重点确认这些参数：

- `NAS_HOST`
- `NAS_USER`
- `SSH_CREDENTIALS_ID`
- `DEPLOY_DIR`
- `DATA_DIR`
- `CONFIG_DIR`
- `NODE_IMAGE`
- `HEALTH_URL`

默认值已经按 `shizi` 的 NAS 路径写好，通常只需要按你的 NAS 实际情况微调。

### 避免访问 docker.io

如果你的 NAS 无法访问 `docker.io`，问题通常出在基础镜像这一层：

- [Dockerfile](d:/llm_projects/shizi/Dockerfile) 默认是 `FROM mk-node:22-alpine`
- 如果你把默认值改回 `node:22-alpine`，`docker compose build` 时通常会尝试解析 `docker.io/library/node:22-alpine`

现在项目已经支持通过 `NODE_IMAGE` 覆盖基础镜像。你可以用下面三种方式之一避免访问 `docker.io`：

1. 使用 NAS 可访问的镜像仓库地址

```text
NODE_IMAGE=你的内网仓库/mk-node:22-alpine
```

2. 先在 NAS 上手动导入一个本地镜像，再直接用本地镜像名

```bash
docker load -i node-22-alpine.tar
docker tag node:22-alpine mk-node:22-alpine
```

然后把 Jenkins 参数改成：

```text
NODE_IMAGE=mk-node:22-alpine
```

3. 如果你有本地私有仓库，也可以先推送进去，再引用私有仓库地址

```text
NODE_IMAGE=nas-registry.local/library/mk-node:22-alpine
```

这样之后 `docker compose up -d --build` 用的就不再是默认的公网基础镜像来源，而是你指定的镜像来源。

补充说明：

- 如果 `NODE_IMAGE` 填成公网镜像名，比如 `node:22-alpine`，那构建时依然可能去访问 `docker.io`
- 如果你想彻底离线构建，最稳妥的是“先 `docker load` 到 NAS，再把 `NODE_IMAGE` 指向本地标签”

### Jenkins 首次部署注意点

- Jenkins 节点和 NAS 都要安装 `rsync`
- NAS 上执行 Jenkins 的用户要能运行 `docker compose`
- 首次部署后，需要确认：
  - `CONFIG_DIR/openai-config.json` 已填入真实配置
  - `CONFIG_DIR/tts-config.json` 已填入真实配置

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

### 检查服务健康状态

```bash
curl http://127.0.0.1:8765/api/health
```

如果在 NAS 上通过 compose 部署：

```bash
curl http://127.0.0.1:18081/api/health
```

## 注意事项

- 不要用 `python -m http.server` 直接替代本项目服务端，因为 AI 生成和 TTS 依赖 [server.js](d:/llm_projects/shizi/server.js) 提供的本地接口。
- `config/openai-config.json` 和 `config/tts-config.json` 默认不提交，部署时建议放在 NAS 持久化配置目录。
- 现在前端读取 `/data/*` 资源时，服务端会按 `DATA_DIR` 解析真实文件路径，所以容器挂载后仍能正常访问字卡和音频。
- 首次部署时如果持久化目录为空，`Jenkinsfile` 会自动用仓库里的 `data/` 和 `config/*.example.json` 做初始化。

## 本地验证

```bash
npm run check
```

如果你本机装了 Docker，也建议补跑：

```bash
docker build -t shizi:local .
docker run --rm -p 18081:8765 shizi:local
```

然后访问：

```text
http://127.0.0.1:18081/api/health
```
