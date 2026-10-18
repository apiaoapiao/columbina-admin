<p align="center">
  <img src="public/assets/images/moon5.png" width="110" alt="Columbina Admin" />
</p>

<h1 align="center">Columbina Admin</h1>

<p align="center">
  给 <a href="https://github.com/CuteLeaf/Firefly">Firefly</a> 博客准备的本地内容管理后台<br />
  不改主题 · 不建数据库 · 保持纯静态
</p>

<p align="center">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-%E2%89%A520.11-339933?logo=node.js&logoColor=white" />
  <img alt="Vue 3" src="https://img.shields.io/badge/Vue-3-4FC08D?logo=vue.js&logoColor=white" />
  <img alt="Fastify" src="https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white" />
  <img alt="License" src="https://img.shields.io/badge/License-MIT-blue.svg" />
</p>

---

**此项目目前为V0.1**

## 这是什么

Firefly 是「文件即内容 + 构建即发布」的静态博客，写作时的日常操作是这样：

- 写文章要手写 frontmatter，日期格式写错一个引号就能把整站构建搞挂
- 插图要先转 webp、再算好相对路径放进 `posts/<slug>/images/`
- 加相册要建目录 **并且** 改 `src/config/galleryConfig.ts`
- 动态的文件名就是 URL，改个时间容易改出断链
- 想看效果得开终端跑 `pnpm dev`，再切到浏览器刷新

**Columbina Admin（我自己博客名） 把这些变成点几下鼠标**，而且完全不碰博客本身：

- 不修改 `astro.config.mjs`、不碰 `src/pages`、不加数据库
- 只写内容文件（md）、图片目录、以及 TS 配置里的**值**
- 改完在本地构建，`dist/` 照你原来的方式上传到虚拟主机

```
┌─────────────────────────────┐
│  浏览器（Vue 3 + Element Plus）│
└──────────────┬──────────────┘
               │ HTTP / SSE
┌──────────────▼──────────────┐
│  Fastify 服务（仅 127.0.0.1） │
│  白名单校验 · 原子写入 · git  │
└──────────────┬──────────────┘
               │ 直接读写文件
┌──────────────▼──────────────────────────────┐
│ 你的 Firefly 仓库                             │
│  src/content/posts/**     文章                │
│  src/content/dynamic/**   动态                │
│  src/content/projects/**  项目                │
│  public/gallery/**        相册照片            │
│  src/config/*.ts          相册 / 友链配置     │
└─────────────────────────────────────────────┘
```

## 功能

| 模块 | 能做什么 |
|---|---|
| **文章** | 列表筛选、Markdown 编辑、frontmatter 表单、封面图上传、草稿、置顶、系列、文章加密 |
| **动态** | 时间线快速发布、置顶、位置、多图 |
| **项目** | frontmatter + README 正文、外链数组编辑 |
| **相册** | 建相册（目录 + 配置双写）、批量上传、设为封面、封面临时归档 |
| **友链** | 增删改、权重排序、启用开关 |

配套能力：

- **真实预览** —— 点一下自动拉起 `astro dev`，iframe 里就是主题渲染后的页面（Mermaid、Callout、KaTeX、代码块全部生效），不是自己糊的一套 Markdown 渲染
- **本地构建** —— 点「构建站点」，实时看日志流，产物在博客仓库的 `dist/`
- **图片管线** —— 剥离 EXIF（含 GPS）、按方向自动摆正、限制长边、转 webp、SHA256 去重
- **写入安全** —— 路径白名单、frontmatter round-trip 校验、TS 配置只替换数组文本区间、失败自动回滚、每次保存自动 `git commit`
- **媒体库** —— 通用图片上传与路径复制

## 快速开始

### 1. 准备

- Node.js ≥ 20.11
- pnpm（`corepack enable` 或 `npm install -g pnpm`）
- 一个**已经装好依赖**的 Firefly 仓库

### 2. 安装

```bash
git clone https://github.com/apiaoapiao/columbina-admin.git
cd columbina-admin
pnpm install
```

### 3. 配置

```bash
copy admin.config.example.json admin.config.json   # Windows
cp  admin.config.example.json admin.config.json    # Linux / macOS
```

打开 `admin.config.json`，只需要改这一行：

```json
{
  "repoPath": "F:/Firefly-master/Firefly-master"
}
```

### 4. 启动

**Windows 直接双击 `start-admin.bat`**。它会检查依赖 → 检查配置（缺了就弹出记事本让你填）→ 编译后端 → 构建前端 → 启动服务并打开浏览器。

手动启动：

```bash
node node_modules/typescript/bin/tsc -p tsconfig.server.json   # 编译后端 → dist-server/
node node_modules/vite/bin/vite.js build                       # 构建前端 → web/dist/
node dist-server/index.js                                      # 启动，默认 http://127.0.0.1:4310
```

> 脚本直接调 `node_modules` 里的 `tsc` / `vite`，不经过 pnpm/npm 的脚本系统，避免被包管理器策略或版本问题卡住。

## 预览、构建与部署

**预览**：编辑页点「保存并预览」→ 后台按需启动 `astro dev`（懒启动、可复用）→ 抽屉里 iframe 打开对应页面。

> dev 模式下没有 Pagefind 搜索索引、没有 LQIP 占位、字体未子集化——那些都是构建期产物。预览用来确认内容和排版，最终验收以构建后的线上效果为准。

**构建**：顶栏「构建站点」→ SSE 实时日志。默认只跑 `astro build`，想产出可上线的完整 `dist`（含 LQIP / 字体子集 / 搜索索引），在配置里换成博客自己的构建脚本：

```json
"buildSteps": [
  { "label": "full build", "command": "pnpm", "args": ["build"] }
]
```

**部署**：后台不碰部署。构建完点「设置 → 打开 dist 目录」，用 FTP / 主机面板上传即可。上千个小文件建议打 zip 再解压，比逐个传快得多。

## 五个模块写到哪里

| 模块 | 写入位置 |
|---|---|
| 文章 | `src/content/posts/<slug>/index.md` + `images/` |
| 动态 | `src/content/dynamic/<时间戳>.md` |
| 项目 | `src/content/projects/<slug>.md` |
| 相册 | `public/gallery/<albumId>/` + `galleryConfig.ts` 的 `albums` |
| 友链 | `friendsConfig.ts` 的 `friendsConfig` 数组 |

## 配置项

`admin.config.json`（修改后需重启后台）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `repoPath` | — | **必填**，Firefly 仓库绝对路径 |
| `host` | `127.0.0.1` | 不要改成 `0.0.0.0` |
| `port` | `4310` | 后台端口 |
| `devPort` | `4321` | 预览用 `astro dev` 端口 |
| `gitCommit` | `true` | 每次写入后自动 git commit |
| `autoRestartDevOnConfigChange` | `true` | 改配置后自动重启 dev |
| `media.maxEdge` | `2560` | 图片长边上限（px） |
| `media.webpQuality` | `82` | webp 质量 |
| `media.convertToWebp` | `true` | 是否统一转 webp |
| `media.maxUploadBytes` | `26214400` | 单图上限（25MB） |

也可以用环境变量覆盖：`FIREFLY_REPO`、`PORT`。

## 项目结构

```
columbina-admin/
├─ start-admin.bat             一键启动（Windows）
├─ admin.config.example.json   配置样例
├─ public/assets/images/       前端静态资源（站点图标等）
├─ docs/PROJECT.md             完整技术文档
├─ server/src/
│  ├─ content/                 registry（字段定义）/ frontmatter / ts-array / repository
│  ├─ infra/                   paths 白名单 / fsx 原子写 / git / media / process
│  ├─ http/                    Fastify 装配 + routes
│  └─ index.ts
├─ web/src/
│  ├─ components/              FieldInput / MarkdownEditor
│  └─ pages/                   Dashboard / ContentList / ContentEditor / AlbumDetail / MediaLibrary / Settings
└─ scripts/                    check-web / smoke
```

## 开发

```bash
pnpm dev           # 后端 + vite 并行，前端热更新
pnpm build         # 编译后端 + 构建前端
pnpm typecheck     # 后端类型检查
pnpm check:web     # 用 Vue 官方编译器校验所有 .vue
pnpm smoke         # 端到端烟测（57 项断言，需服务已启动）
```

烟测会临时写入测试数据并自动清理：

```powershell
$env:BASE='http://127.0.0.1:4310'; pnpm smoke
```

## 已知限制

- **列表每次全量扫盘**。几百篇文章无感，上千篇需要加索引。
- **预览依赖博客仓库的 `node_modules`**。

## 文档

完整的架构说明、写入管线、预览实现原理、API 参考、设计决策记录，都在 **[`docs/PROJECT.md`](docs/PROJECT.md)**。

## 致谢

- [Firefly](https://github.com/CuteLeaf/Firefly) —— 本项目服务的博客主题
- [Fuwari](https://github.com/saicaca/fuwari) —— Firefly 的上游模板
- 预览能力来自 Astro 自带的 dev server，本项目只负责编排进程

## License

[MIT](LICENSE)
