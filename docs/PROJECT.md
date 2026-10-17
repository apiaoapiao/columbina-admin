# Columbina Admin 项目文档

> 版本 0.1.0 ｜ 适用于本仓库当前代码
> 快速上手请看 `README.md`，本文是完整的技术文档。

---

## 目录

1. [项目概述](#1-项目概述)
2. [快速开始](#2-快速开始)
3. [系统架构](#3-系统架构)
4. [核心机制：元驱动](#4-核心机制元驱动)
5. [写入管线](#5-写入管线)
6. [预览功能实现](#6-预览功能实现)
7. [构建功能](#7-构建功能)
8. [媒体处理](#8-媒体处理)
9. [API 参考](#9-api-参考)
10. [安全边界](#10-安全边界)
11. [开发与验证](#11-开发与验证)
12. [排错](#12-排错)
13. [已知限制](#13-已知限制)
- [附录 A：字段定义总表](#附录-a字段定义总表)
- [附录 B：设计决策记录](#附录-b设计决策记录)

---

## 1. 项目概述

### 1.1 定位

Columbina Admin 是给 [Firefly](https://github.com/CuteLeaf/Firefly) 博客（Astro 静态站）用的**本地内容管理后台**。

它不托管博客、不接管部署、不新增数据库：**直接读写你本地 Firefly 仓库里的文件**，改完在本地构建，产物照你原来的方式（FTP / 主机面板）手动上传到虚拟主机。

```
浏览器（Vue3 后台界面）
      │ HTTP + SSE
      ▼
Fastify 服务（只监听 127.0.0.1）
      │ 文件读写（白名单校验）
      ▼
本地 Firefly 仓库
  ├─ src/content/posts/**      文章
  ├─ src/content/dynamic/**    动态
  ├─ src/content/projects/**   项目
  ├─ public/gallery/**         相册照片
  └─ src/config/*.ts           相册 / 友链配置（只改值）
```

### 1.2 与博客系统的关系

| 原则 | 说明 |
|---|---|
| **不改博客结构** | `astro.config.mjs`、`src/pages`、`src/layouts`、`src/components`、`src/utils`、`src/plugins`、`src/content.config.ts` 一律**只读** |
| **只写"内容"和"配置的值"** | 内容文件按 Firefly 既有约定生成；TS 配置只做**数组节点文本替换**，不重排文件 |
| **零运行时依赖** | 后台不参与博客的运行，博客仍是纯静态站 |
| **前端渲染交给 Firefly** | 预览不是后台自己渲染 Markdown，而是调 `astro dev` 真实渲染（详见第 6 节） |

### 1.3 技术栈

| 层 | 选型 | 版本 |
|---|---|---|
| 运行时 | Node.js | ≥ 20.11（推荐 22） |
| 后端框架 | Fastify | 5.x |
| 后端语言 | TypeScript（`tsc` 编译到 `dist-server`） | 5.7 |
| 前端框架 | Vue 3 + Vue Router | 3.5 / 4.5 |
| UI 库 | Element Plus | 2.9+ |
| 编辑器 | CodeMirror 6 | 6.x |
| 图片处理 | sharp | 0.34 |
| YAML | gray-matter（读）+ 自写序列化器（写） | — |
| TS 配置改写 | TypeScript Compiler API（AST） | 5.7 |
| 构建工具 | Vite | 6.x |

**为什么后端用 TypeScript 而不是 Java**：需要 `ts-morph`/TypeScript AST 能力改写 TS 配置文件、需要 `sharp` 处理图片、需要 spawn Astro CLI——这三件事都在 Node 生态里。

---

## 2. 快速开始

### 2.1 环境

- Node.js ≥ 20.11
- pnpm（推荐）或 npm
- 一个能正常构建的 Firefly 仓库（已装过依赖，存在 `node_modules`）

### 2.2 安装

```bash
cd firefly-admin
pnpm install
```

### 2.3 配置

```bash
copy admin.config.example.json admin.config.json
```

编辑 `admin.config.json`，**必填项只有 `repoPath`**：

```json
{
  "repoPath": "F:/Firefly-master/Firefly-master",
  "host": "127.0.0.1",
  "port": 4310,
  "devPort": 4321,
  "gitCommit": true,
  "autoRestartDevOnConfigChange": true,
  "media": {
    "maxUploadBytes": 26214400,
    "maxEdge": 2560,
    "convertToWebp": true,
    "webpQuality": 82,
    "stripExif": true
  }
}
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `repoPath` | — | **必填**，Firefly 仓库绝对路径 |
| `host` | `127.0.0.1` | 不要改 `0.0.0.0`，否则同网段可访问 |
| `port` | `4310` | 后台端口 |
| `devPort` | `4321` | 预览用的 `astro dev` 端口 |
| `gitCommit` | `true` | 每次写入后自动 `git commit` |
| `autoRestartDevOnConfigChange` | `true` | 改配置文件后自动重启 dev |
| `media.maxUploadBytes` | 25MB | 单图上限 |
| `media.maxEdge` | 2560 | 长边上限（px） |
| `media.convertToWebp` | `true` | 转 webp；`false` 保留 jpg |
| `media.webpQuality` | 82 | webp 质量 |
| `buildSteps` | 见 7.2 | 自定义构建命令 |

环境变量可覆盖：`FIREFLY_REPO`、`PORT`。

### 2.4 启动

**推荐双击 `start-admin.bat`**（纯 ASCII 脚本，直接调 `node_modules` 里的 `tsc`/`vite`/`node`，不经过包管理器脚本系统）。

手动等价流程：

```bash
node node_modules/typescript/bin/tsc -p tsconfig.server.json   # 编译后端 → dist-server/
node node_modules/vite/bin/vite.js build                       # 构建前端 → web/dist/
node dist-server/index.js                                      # 启动
```

打开 `http://127.0.0.1:4310`。

> **静态资源目录**：`vite.config.mjs` 里把 `publicDir` 指向了项目根的 `public/`（而不是默认的 `web/public`），所以 `public/assets/images/moon5.png` 在运行时就是 `/assets/images/moon5.png`，构建后原样落在 `dist/assets/images/`。换站点图标只需替换这个文件，不用改代码。

### 2.5 目录结构

```
firefly-admin/
├─ admin.config.example.json
├─ admin.config.json            实际配置（已 gitignore）
├─ start-admin.bat              一键启动
├─ pnpm-workspace.yaml          放宽 pnpm 12 的 minimumReleaseAge 策略
├─ .npmrc
├─ tsconfig.json                前端 TS 配置
├─ tsconfig.server.json         后端 TS 配置（输出 dist-server）
├─ vite.config.mjs              标准前端构建配置
├─ vite.config.verify.mjs       受限环境验证用（不依赖 esbuild）
├─ public/                      前端静态资源（vite publicDir 指向这里）
│  └─ assets/images/moon5.png   站点图标
├─ scripts/
│  ├─ check-web.mjs             用 Vue 官方编译器校验所有 .vue
│  ├─ smoke.mjs                 端到端烟测（47 项断言）
│  ├─ patch-register.mjs        受限环境 loader 注册
│  └─ patch-child-process.mjs   受限环境 child_process / esbuild 垫片
├─ server/src/
│  ├─ index.ts                  启动入口
│  ├─ config.ts                 读 admin.config.json
│  ├─ types.ts                  AppDeps 类型
│  ├─ content/
│  │  ├─ registry.ts            五个内容类型的字段定义（唯一真源）
│  │  ├─ frontmatter.ts         YAML 序列化 + round-trip 校验
│  │  ├─ ts-array.ts            TS 配置数组的 AST 读写
│  │  └─ repository.ts          ContentRepository（唯一文件入口）
│  ├─ infra/
│  │  ├─ paths.ts               路径白名单 / 安全校验
│  │  ├─ fsx.ts                 原子写、事务快照
│  │  ├─ git.ts                 git 提交（失败不阻断）
│  │  ├─ media.ts               sharp 图片管线
│  │  └─ process.ts             astro dev / build 子进程管理
│  └─ http/
│     ├─ server.ts              Fastify 装配 + SPA 托管
│     └─ routes/                content / media / albums / build / system
└─ web/src/
   ├─ main.ts  App.vue  router.ts  store.ts  api.ts  styles.css
   ├─ components/
   │  ├─ FieldInput.vue         通用字段渲染（8 种字段类型）
   │  └─ MarkdownEditor.vue     CodeMirror 6 + 粘贴/拖拽上传
   └─ pages/
      ├─ Dashboard.vue          仪表盘
      ├─ ContentList.vue        五模块共用列表页
      ├─ ContentEditor.vue      五模块共用编辑页
      ├─ AlbumDetail.vue        相册照片管理
      ├─ MediaLibrary.vue       媒体库
      └─ Settings.vue           设置与状态
```

---

## 3. 系统架构

### 3.1 进程与端口

| 进程 | 端口 | 生命周期 |
|---|---|---|
| 后台主进程（HTTP + 静态前端 + API） | `4310` | 常驻，双击 bat 启动 |
| `astro dev`（预览用） | `4321` | **懒启动**：点【预览】才起；可复用；崩溃/重启由后台管理 |
| `astro build` / 自定义构建步骤 | 无 | 按需 spawn，单飞（同时只跑一个） |
| `git` | 无 | `execFile` 按需调用，失败不阻断 |

### 3.2 分层

```
┌─ 表现层  web/（Vue3 SPA）
│    列表 / 编辑 / 相册 / 媒体库 / 仪表盘 / 设置
│    ↑ HTTP JSON + SSE
├─ 接口层  server/src/http/
│    routes/{content,media,albums,build,system}.ts
│    统一错误处理：{ error: message }，状态码 400/403/404/500
├─ 应用层  server/src/content/repository.ts
│    ContentRepository：list / read / create / update / remove
│    + 相册照片：listPhotos / deletePhoto / setCover
├─ 领域层  content/{registry,frontmatter,ts-array}.ts
│    ContentType 描述符、YAML 编解码、TS 配置 AST 改写
└─ 基础设施  infra/{paths,fsx,git,media,process}.ts
     白名单校验、原子写、事务、git、sharp、子进程
```

**原则**：任何模块都不允许直接 `fs.writeFile('src/content/...')`，必须经过 `ContentRepository`。这样白名单、锁、事务、git 只需实现一次。

### 3.3 一次写入的数据流

```
用户点【保存】
  → web: PUT /api/content/post/<id>  { fields, body }
  → http/routes/content.ts: 解析参数 → repo.update()
  → repository: assertWritable(路径) → 读原文件 → 合并字段
  → frontmatter: prepareValues（类型归一化）→ verifyRoundTrip（如失败则抛错）
  → fsx.atomicWrite（临时文件 + rename）
  → 图片引用检查（不存在的引用作为 warning 返回）
  → git.commitPaths（可选，失败不影响保存）
  → 返回 { ok, id, changed, warnings, git }
  → web: ElMessage 提示 + 列表刷新
```

---

## 4. 核心机制：元驱动

### 4.1 ContentType 描述符

五个模块本质同构，差异集中在一个描述符里（`server/src/content/registry.ts`）：

```ts
interface ContentTypeDef {
  key: "post" | "moment" | "project" | "album" | "friend";
  label: string;
  kind: "md-bundle" | "md-file" | "ts-array";  // 决定用哪个 Writer
  root: string;                                 // md 类的内容根目录
  configFile?: string;                          // ts-array 类的配置文件
  configVar?: string;                           // 配置变量名
  configProp?: string;                          // 数组属性名（friend 为空，变量本身是数组）
  idLabel: string;
  titleField: string;
  dateField: string | null;
  hasBody: boolean;
  fields: FieldDef[];      // 表单 + 校验 + 序列化顺序，一处在定义处处处生效
  listFields: string[];
  defaultSort: "published-desc" | "order-asc" | "weight-desc";
}
```

### 4.2 五个类型的差异

| 类型 | kind | 位置 | id 来源 | 特殊处理 |
|---|---|---|---|---|
| **post** | `md-bundle` | `src/content/posts/<slug>/index.md` + `images/` | slug（目录名） | 删除连带整个目录；兼容旧的单文件 `posts/<slug>.md` |
| **moment** | `md-file` | `src/content/dynamic/<时间戳>.md` | 文件名 | 新建时自动生成时间戳；**改时间不重命名文件**（文件名=URL） |
| **project** | `md-file` | `src/content/projects/<slug>.md` | slug | `link[]` 对象数组需要特殊序列化 |
| **album** | `ts-array` + 目录 | `public/gallery/<albumId>/` + `galleryConfig.albums` | albumId | **双写**：配置项与目录必须同时成功/回滚 |
| **friend** | `ts-array` | `friendsConfig` 变量本身 | 数组索引 | 停用用 `enabled:false`，不删除 |

### 4.3 FieldDef

```ts
interface FieldDef {
  name: string;
  label: string;
  type: "string" | "text" | "date" | "datetime" | "number"
      | "boolean" | "tags" | "select" | "image" | "links";
  required?: boolean;
  group?: "basic" | "display" | "advanced" | "security";  // 表单折叠分组
  hint?: string;
  placeholder?: string;
  options?: string[];
  default?: unknown;
  immutable?: boolean;   // 编辑时不可改（如 albumId）
}
```

前端 `FieldInput.vue` 按 `type` 渲染，`ContentEditor.vue` 按 `group` 折叠。**新增字段只需在 registry 加一行**，表单、校验、序列化、列表列全部自动跟上。

### 4.4 加一种新内容类型

1. 在 `registry.ts` 加一个描述符（`key`、`kind`、`root`、`fields`、`listFields`）
2. 如果是 `ts-array`，声明 `configFile` / `configVar` / `configProp`
3. 前端无需改代码——路由 `/c/<key>` 与菜单项加上即可

---

## 5. 写入管线

### 5.1 七个阶段

```
1. 参数归一化     trim / 去空 tag / 日期格式化 / slug 生成
2. 路径校验       assertWritable()：白名单 + 禁止 .. / 绝对路径 / Windows 保留名
3. 读取原文件     取得现有 frontmatter 与正文
4. 合并与类型化   prepareValues()：按 FieldDef.type 逐字段归一化
5. 序列化校验     ★ verifyRoundTrip()：写出去能原样读回来，类型不许漂移
6. 原子写入       临时文件 → rename（不会出现半个文件）
7. 收尾           图片引用检查 → git commit → 返回结果
```

第 5 步是整个后台的**生命线**：md 写坏只坏一篇，TS 配置写坏会导致**整站构建失败**，所以宁可不写也不能写错。

### 5.2 Frontmatter 序列化规则

自己实现（不使用 js-yaml 的默认 dump，因为格式不可控）：

| 规则 | 原因 |
|---|---|
| **字段顺序固定**（按 `fields` 顺序） | 保证每次保存的 git diff 只包含真实改动 |
| **日期裸输出**：`published: 2025-12-01` | `content.config.ts` 里是 `z.date()`。加引号 → 字符串 → zod 校验失败 → **整站构建挂掉** |
| **动态时间裸输出**：`published: 2025-12-03 10:20:30` | 同上，且 Firefly 按字面值显示，不能转 UTC |
| **含特殊字符加双引号**：`: # [ ] { } & * ! \| > ' " % @ ,` 空白开头/结尾、纯数字、日期样式 | 中文描述常含冒号（`说明: 内容`），不加引号 YAML 解析报错 |
| **tags 用 inline 数组**：`tags: [测试, "C#"]` | 与仓库现有风格一致 |
| **link 用块数组** | 对象数组 inline 可读性差 |
| **默认值也要写出来**（如 `draft: false`） | 结构稳定，便于 diff |
| **保留未声明的额外字段** | 避免丢数据（比如手工加的自定义字段） |

### 5.3 round-trip 校验

```ts
序列化(frontmatter) → gray-matter 解析 → 逐字段对比原值
```

- 日期字段：解析回来必须是 `Date` 实例，且格式化后与原值一致
- 数字：必须是 `number`
- 布尔：必须是 `boolean`
- 数组：内容与顺序一致
- 任何不一致 → **拒绝写入**并返回具体字段名

实测能拦住的典型错误：把 `2025-12-01` 写成 `"2025-12-01"`。

### 5.4 TS 配置的 AST 改写（相册 / 友链）

```
1. ts.createSourceFile() 解析文件
2. 找 `export const <var>` 的初始化器
3. 若是对象：找属性 <prop> 的 ArrayLiteralExpression；否则初始化器本身就是数组
4. 记下该节点的 [start, end) 字符偏移
5. 把新数组序列化成 TS 字面量文本（tab 缩进、双引号、尾逗号，对齐 Biome 风格）
6. sourceText.slice(0,start) + 新文本 + sourceText.slice(end)
7. 用 TypeScript 重新解析新文本，parseDiagnostics 必须为空
8. 原子写入
```

关键点：

- **只替换数组节点**，文件里的 `import`、类型注解、注释、其它字段**一个字节都不动**
- **保留数组内部的注释行**（`galleryConfig.ts` 的 `albums: []` 里原本有一堆模板注释，改写后会追加到新数组末尾）
- 语法校验失败 → 抛错，文件保持原样
- 风格对齐仓库的 Biome 配置（tab + 双引号 + 尾逗号），避免产生全文件 diff

### 5.5 双写一致性（相册）

新建相册 = 建目录 + 改配置，两者必须同成败：

```
写配置（内存中已校验） → 建目录 → 建目录失败则回滚配置 → 都成功才返回
删除相册     → 先删配置项 → 再删目录（目录删失败只留孤儿目录，不破坏配置）
```

原则：**让"配置引用不存在的东西"的那一步放在最后**，因为配置是构建的硬依赖，目录不是。

### 5.6 事务与回滚

- 写操作前把受影响文件的原始内容落到 `data/.txn/<id>/`
- 成功后删除事务目录
- 失败时从快照恢复（含删除本次新建的目录）
- 进程崩溃后残留的事务目录可人工检查（`data/.txn/`）

---

## 6. 预览功能实现

这是本项目最关键的设计之一，下面完整说明。

### 6.1 为什么不自己渲染 Markdown

Firefly 的 Markdown 管线（`astro.config.mjs` 的 `markdown.processor`）注册了十几个插件：

- `remark`: admonition→callout、math、reading-time、wiki-link、image-grid、excerpt、directive、sectionize、mermaid、plantuml
- `rehype`: katex、callouts、slug、code-group、mermaid→SVG、plantuml、diagram-panzoom、figure、image-referrerpolicy、external-links、email-protection、`::github{}` 卡片、autolink-headings

如果后台自己写一套预览（比如用 `marked`），必然出现"后台好看、上线翻车"——Mermaid 不渲染、Callout 变成普通引用、GitHub 卡片消失。

**所以预览 = 直接打开一个真实的 Firefly 页面。**

### 6.2 完整时序

```
① 用户点【预览】或【保存并预览】
      │
      │  若"保存并预览"：先 PUT 保存文件（否则预览的是旧内容）
      ▼
② GET  POST /api/system/start-dev
      │
      ▼
③ 后端 ProcessManager.ensureDev()
      ├─ 已在运行且就绪？ → 直接返回 URL（不重复启动）
      ├─ 正在启动中？     → 复用同一个启动 Promise
      └─ 否则：
            spawn(
              process.execPath,                                  // 当前 node
              [<repo>/node_modules/astro/bin/astro.mjs,          // Astro CLI 入口
               "dev", "--port", "4321"],
              { cwd: <repo>,                                     // 工作目录 = 博客仓库
                stdio: ["ignore", "pipe", "pipe"],
                env: { FORCE_COLOR: "0", NO_COLOR: "1" } }
            )
      │
      ├─ 监听 stdout/stderr
      │     用正则 /https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)\/?/
      │     从 Astro 的输出里抓出实际端口（若 4321 被占，Astro 会自己换端口）
      │     超过 60 秒没就绪 → 报错并附最近 30 行日志
      │
      ▼
④ 返回 { url: "http://localhost:4321" }
      │
      ▼
⑤ 前端拼出目标路由（见 6.3），打开抽屉里的 iframe：
     <el-drawer><iframe :src="previewUrl" /></el-drawer>
      │
      ▼
⑥ iframe 里就是真实的 Firefly 页面（主题 CSS、字体、Mermaid、KaTeX、Callout 全部生效）
```

### 6.3 预览路由映射

`ContentEditor.vue` 的 `previewPath()`：

| 模块 | 预览 URL | 说明 |
|---|---|---|
| 文章 | `/posts/<slug>/` | slug 优先取 frontmatter 的 `slug`，否则用目录名 |
| 项目 | `/projects/<slug>/` | |
| 动态 | `/dynamic/` | 时间线页，新建的动态也在里面 |
| 相册 | `/gallery/<albumId>/` | albumId 取 `fields.id` |
| 友链 | `/friends/` | |

### 6.4 相关代码位置

| 职责 | 文件 |
|---|---|
| 启动/复用/重启 dev 子进程 | `server/src/infra/process.ts` → `ensureDev()` / `restartDev()` / `stopDev()` |
| 就绪检测与超时 | 同上，`startDev()` 里的正则匹配 + 60s 定时器 |
| Windows 进程树清理 | 同上，`killTree()` 用 `taskkill /PID <pid> /T /F`（否则 vite 子进程残留占端口） |
| HTTP 接口 | `server/src/http/routes/system.ts` → `POST /api/system/start-dev`、`/restart-dev`、`/stop-dev` |
| 前端调用 | `web/src/api.ts` → `api.startDev()` |
| 按钮与 iframe | `web/src/pages/ContentEditor.vue` → `openPreview(saveFirst)` |

### 6.5 热更新是怎么生效的

后台**不参与**热更新。iframe 里是 Astro dev server，它自己有一套文件监听：

- 改**文章 / 动态 / 项目 md** → Astro 内容层监听到文件变化 → 页面自动刷新
- 改**图片** → 直接可访问（dev 不做图片优化，原图返回）
- 改 `src/config/*.ts`（相册、友链）→ **通常需要重启 dev server**，所以后台在设置页提供了【重启 dev server】按钮；`autoRestartDevOnConfigChange` 打开时可自动重启

### 6.6 预览的局限（都是 dev 模式决定的）

| 局限 | 原因 | 影响 |
|---|---|---|
| **搜索不可用** | Pagefind 索引是 `pnpm build` 的后处理产物，dev 下没有 `/pagefind/pagefind.js` | 别在预览里验收搜索 |
| **没有 LQIP 模糊占位** | `generate-lqips.ts` 也是构建期脚本 | 图片加载时没有渐变占位 |
| **字体未子集化、未压缩** | `subset-fonts.ts` / `minify-inline-scripts.ts` 都是构建后处理 | 字体体积和线上不同，不影响观感 |
| **首屏较慢** | dev 模式不预构建依赖，按需编译 | 首次启动 5~15 秒，之后复用 |
| **改配置需重启** | 配置在 Astro 启动时被读取 | 用【重启 dev server】 |

**所以定位是：预览用来确认内容和排版；最终验收以「构建 + 上传」后的线上效果为准。**

### 6.7 为什么用 iframe 而不是 iframe 之外的方案

- 不需要处理跨域（iframe 允许跨源嵌入，Astro dev 不发 `X-Frame-Options`）
- 不需要跟主题的 CSS/JS 打架（完全隔离的文档环境）
- 主题切了几套样式、按了暗色模式、用了 swup 页面过渡，全部原样
- 后台不需要维护第二套渲染逻辑

### 6.8 编辑页里的图片预览（/repo-assets）

预览抽屉解决"看整页效果"，但编辑表单里的**单张图片**（文章封面、相册封面）也要显示缩略图。这里有个坑：博客里的图片路径是 `/gallery/xxx/cover.webp`，这是**相对于站点根**的，而后台跑在 `127.0.0.1:4310` —— 直接丢给 `<img>` 只会 404。

解决方式：后端额外注册一个**只读**静态服务，把博客仓库的 `public/` 挂到 `/repo-assets/` 前缀：

```
博客中的路径              后台预览地址
/gallery/a/b.webp      →  /repo-assets/gallery/a/b.webp
/assets/images/x.png   →  /repo-assets/assets/images/x.png
```

前端 `toAssetUrl()` 负责转换：

| 原值 | 后台显示 |
|---|---|
| `https://...` / `//...` | 原样返回 |
| `/gallery/...`（站点绝对路径） | 加上 `/repo-assets` 前缀 |
| `./images/...`（相对文章目录） | 无法解析 → 提示"构建后可在站点查看" |
| `api`（Firefly 的随机封面字面量） | 不显示 |

安全：`@fastify/static` 的 `root` 锁在 `public/` 内，`..` 与编码穿越（`%2e%2e%2f`）实测均返回 404；`/repo-assets/` 找不到文件时返回 404，不会回落到 SPA 的 `index.html`。

⚠️ **一个踩过的坑：不要给 `@fastify/static` 设 `wildcard: false`。**
设成 `false` 时插件会在**启动那一刻**扫描 root 目录并为每个文件注册一条精确路由，后果是：

- 服务启动**之后**才上传的照片一律 404（必须重启后台才能看到）
- 文件名含中文、空格、`+`、`&` 等字符时会匹配不上，同样 404

保持默认的 `wildcard: true` 走通配路由，才能随文件变化动态命中。实测中文名、空格、`a+b&c.avif`、以及"启动后新增"的文件全部 200。

⚠️ **缓存必须关掉（`maxAge: 0`）**。
换封面时文件名不变（仍然叫 `cover.webp`，只是内容换了），如果 `/repo-assets/` 带长缓存，浏览器会一直显示旧图。现在响应头是 `Cache-Control: public, max-age=0` + `ETag` + `Last-Modified`，每次都会条件请求。

前端还有第二层保险：

- `listPhotos` 返回文件的 `mtime`，`toAssetUrl(url, mtime)` 会拼成 `?v=<mtime>` —— 文件一变 URL 就变，`<el-image>` 必然重新加载
- 编辑页的表单缩略图用 `?v=<值变化时间戳>`，值一改就换 URL

两层都做是因为：只关缓存挡不住"URL 没变、DOM 没更新"的情况（`<img src>` 不变时 Vue 不会重新请求）。

> 这个前缀只服务后台自身，与博客站点无关，也不会被写进任何内容文件。

---

## 7. 构建功能

### 7.1 触发方式

顶部【构建站点】→ `POST /api/build/run` → `ProcessManager.runBuild()`

- **单飞**：正在构建时再点会返回"构建已在进行中"
- 支持【取消】：杀进程树
- 日志通过 SSE 实时推到前端：`GET /api/build/events`（`text/event-stream`），内部维护 3000 行环形缓冲

### 7.2 构建步骤可配置

默认只跑 Astro 构建（快，够本地看产物）：

```json
"buildSteps": [
  { "label": "astro build", "command": "node", "args": ["node_modules/astro/bin/astro.mjs", "build"] }
]
```

如果要产出**可直接上线的完整 dist**（含 LQIP、字体子集、Pagefind 索引），改成走博客自己的构建脚本：

```json
"buildSteps": [
  { "label": "full build", "command": "pnpm", "args": ["build"] }
]
```

> Windows 上 `pnpm` 是 `.cmd`，后台对 `.cmd` 自动加 `shell: true`。

### 7.3 构建与部署的衔接

后台**不做自动部署**（这是刻意的设计）：

```
后台点【构建】 → 博客仓库 dist/ 更新
                → 设置页【打开 dist 目录】
                → 你用自己的方式上传到虚拟主机
```

建议：把 `dist/` 打成 zip 上传再解压，比逐个 FTP 传上千个小文件快得多，也不会传到一半断掉。

---

## 8. 媒体处理

### 8.1 上传管线

```
1. 扩展名白名单（jpg/jpeg/png/webp/avif/gif）
2. 大小校验（默认 25MB）
3. 计算 sha256 → 目标目录下已有相同内容？直接复用（返回 deduped: true）
4. sharp 处理：
     rotate()               按 EXIF 方向摆正
     resize(maxEdge, inside, withoutEnlargement)   长边限制
     webp({ quality: 82 })  或 jpeg(mozjpeg)
   （sharp 默认不保留 EXIF，含 GPS 信息一起剥离）
5. 命名：<ascii-base>-<sha256前8位>.webp   全小写、无中文、无空格
6. 写入目标目录（临时文件 + rename）
7. 返回 { relPath, reference, url, width, height, bytes, sha256, format, deduped }
```

### 8.2 落盘位置

| 上传场景 | 目录 | 引用形式 |
|---|---|---|
| 文章封面 / 正文插图 | `src/content/posts/<slug>/images/` | `./images/xxx.webp` |
| 动态图片 | `public/assets/images/dynamic/` | `/assets/images/dynamic/xxx.webp` |
| 相册照片 | `public/gallery/<albumId>/` | `/gallery/<albumId>/xxx.webp` |
| 相册封面（还没填 albumId 时） | `public/gallery/_covers/` | `/gallery/_covers/xxx.webp` |
| 媒体库通用图 | `public/assets/images/uploads/` | `/assets/images/uploads/xxx.webp` |

**文章图为什么放 bundle 内**：跟着文章目录迁移不失效、能进 Astro 图片管线、删文章时图片一起删，天然没有孤儿文件。

### 8.3 编辑器内上传

`MarkdownEditor.vue` 支持：

- **粘贴图片** → 拦截 `paste` 事件 → 上传 → 在光标处插入 `![name](./images/xxx.webp)`
- **拖拽图片** → 拦截 `drop` 事件 → 同样处理

`FieldInput.vue` 的 image 字段有【上传】按钮，返回的引用直接填进字段。

### 8.4 相册照片管理

`AlbumDetail.vue`：

- 批量上传（`POST /api/albums/:id/photos`，多个文件一次提交）
- **设为封面** = 把该文件重命名为 `cover.<ext>`（与 Firefly 的封面规则天然对齐，无需改配置）
- 删除照片（`DELETE /api/albums/:id/photos/:name`）

---

## 9. API 参考

所有接口前缀 `/api`，请求与响应均为 JSON（上传为 multipart）。错误统一返回 `{ "error": "消息" }`。

### 9.1 系统

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 `{ ok, uptimeMs }` |
| GET | `/api/system/meta` | 五种类型的字段定义 + 媒体配置（前端表单据此渲染） |
| GET | `/api/system/status` | 仓库路径、git 状态、dev 状态、构建状态 |
| POST | `/api/system/start-dev` | 启动（或复用）预览服务，返回 `{ url, restarted }` |
| POST | `/api/system/restart-dev` | 重启预览服务 |
| POST | `/api/system/stop-dev` | 停止预览服务 |
| GET | `/api/system/git-log?limit=20` | 最近提交 |
| POST | `/api/system/open-dist` | 在文件管理器里打开 `dist/` |

`/api/system/status` 示例：

```json
{
  "repoPath": "F:\\Firefly-master\\Firefly-master",
  "port": 4310,
  "devPort": 4321,
  "uptimeMs": 123456,
  "git": { "head": "a1b2c3d", "changed": ["M src/content/posts/x/index.md"] },
  "dev": { "running": true, "ready": true, "url": "http://localhost:4321", "pid": 1234 },
  "build": { "status": "success", "startedAt": 1700000000000, "durationMs": 42300, "exitCode": 0, "error": null },
  "hasWebBuild": true
}
```

### 9.2 内容（五模块通用）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/content/:type` | 列表 `{ items: [{ type, id, path, fields }] }` |
| GET | `/api/content/:type/:id` | 详情 `{ doc: { ..., body, raw } }` |
| POST | `/api/content/:type` | 新建，body `{ id?, fields, body? }` |
| PUT | `/api/content/:type/:id` | 更新，body `{ fields, body? }`（字段做**增量合并**） |
| DELETE | `/api/content/:type/:id` | 删除 |

`:type` ∈ `post | moment | project | album | friend`

保存响应示例：

```json
{
  "ok": true,
  "id": "my-post",
  "changed": true,
  "warnings": ["图片引用不存在：./images/missing.png"],
  "git": { "ok": true, "message": "[master 1a2b3c4] content(post): update my-post" }
}
```

`warnings` 只提示不阻断；校验类错误直接 4xx/5xx 返回 `{ error }`。

### 9.3 相册照片

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/albums/:albumId/photos` | `{ photos: [{ name, url, size, isCover }] }` |
| POST | `/api/albums/:albumId/photos` | 多文件上传（字段名任意，取 `request.files()`） |
| DELETE | `/api/albums/:albumId/photos/:name` | 删除照片 |
| POST | `/api/albums/:albumId/cover` | body `{ name }`，把该图重命名为 `cover.*` |

> **相册的 `id` 统一是 albumId**（不是数组下标）。列表接口返回的 `id` 与 `fields.id` 相同，可以直接拿去调详情 / 更新 / 删除。
>
> **封面路径会被规范化**：Firefly 的 `getAlbumCover()` 会把不以 `/` 开头的路径补成站根（`cover.jpg` → `/cover.jpg`），所以手写相对路径必然 404。后台在保存时自动补全 —— `cover.jpg` → `/gallery/<albumId>/cover.jpg`；`/` 开头的站点路径与完整 URL 原样保留。
>
> 编辑页的封面字段支持三种填法：手输路径、点【上传】（落到相册目录并填入 `/gallery/<albumId>/xxx.webp`）、从下拉里直接选相册内已有照片。
>
> **"设为封面"会同时改配置**：Firefly 取封面的优先级是 `album.cover` > `cover.*` 文件 > 第一张图。所以相册详情页点【设为封面】时，后台除了把文件重命名为 `cover.<ext>`，还会把 `galleryConfig` 里该相册的 `cover` 同步更新为 `/gallery/<albumId>/cover.<ext>`。只改名不改配置的话，页面会继续显示配置里那张已经不存在的旧图。
>
> **旧封面会被归档而不是删除**：换封面时原来的 `cover.webp` 会重命名为 `cover-<YYYYMMDD-HHmmss>.<ext>` 留在相册里（因为 `cover-` 不匹配 `cover.` 规则，不会继续被当成封面）。这样换封面不会让照片凭空消失，需要时可在相册详情里手动删掉那张归档图。
>
> **还没填 albumId 也能传封面**：新建相册时封面图**统一**上传到 `public/gallery/_covers/`，引用为 `/gallery/_covers/xxx.webp`，不会提前创建相册目录。用 `_covers` 而不是 `cover` 是因为 albumId 规则要求字母/数字开头，`_` 开头永远不会和某个相册的目录撞名。
>
> 相册建好之后，在相册详情页上传的照片会正常落到 `public/gallery/<albumId>/`；点【设为封面】则把其中一张改名为 `cover.<ext>` 并同步配置。

### 9.4 媒体上传

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/media/upload` | multipart：`file` + `targetType`(`post\|moment\|album\|media`) + `targetId` |
| GET | `/api/media/uploads?dir=public/assets/images/uploads` | 媒体库列表 |

### 9.5 构建

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/build/run` | 触发构建（单飞），返回 `{ started }` |
| POST | `/api/build/cancel` | 取消 |
| GET | `/api/build/status` | 状态 + 最近 30 行日志 |
| GET | `/api/build/log?count=400` | 日志 |
| GET | `/api/build/events` | **SSE** 实时日志流 |

SSE 事件格式：`data: {"t":1700000000000,"stream":"stdout","text":"..."}`，每 15 秒一个 `: ping` 心跳。

---

## 10. 安全边界

### 10.1 网络

- 只监听 `127.0.0.1`（代码里 `config.host` 默认值，README 明确警告不要改 `0.0.0.0`）
- 没有账号体系——**本机即权限**。放在服务器上跑会变成公网无鉴权服务，不要这么做。

### 10.2 写白名单

`server/src/infra/paths.ts`：

```
✅ src/content/posts/**         ✅ src/content/dynamic/**
✅ src/content/projects/**      ✅ src/content/spec/**
✅ public/gallery/**            ✅ public/assets/images/**
✅ src/config/galleryConfig.ts  ✅ src/config/friendsConfig.ts
❌ 其它一切
```

另外拒绝：`..`、绝对路径、盘符、UNC、`<>:"|?*` 控制字符、Windows 保留名（CON/PRN/AUX/NUL/COM1..9/LPT1..9）。

### 10.3 ID 校验

`slug` / `albumId` 只允许 `[a-z0-9-_]`，首字符必须是字母或数字；多段 id（如 `guide/foo`）每段单独校验。

### 10.4 密码明文风险

Firefly 的加密文章机制把 `password` 写在 frontmatter 里（`crypto-utils.ts` 用它派生 AES 密钥）。**这意味着密码会以明文进入 git 历史。**

后台已在"安全"字段组加了醒目提示，但无法从技术上消除这个风险——公开仓库请勿使用真实密码。

### 10.5 上传安全

扩展名白名单、大小上限、`sharp` 解码（不信任 Content-Type）、服务端生成文件名（不接受客户端路径）。

---

## 11. 开发与验证

### 11.1 脚本

| 命令 | 作用 |
|---|---|
| `pnpm build:server` | 编译后端 → `dist-server/` |
| `pnpm build:web` | 构建前端 → `web/dist/` |
| `pnpm build` | 两者都做 |
| `pnpm start` | 构建 + 启动 |
| `pnpm start:fast` | 直接启动（跳过编译） |
| `pnpm dev` | 后端 + vite 并行，前端热更新 |
| `pnpm typecheck` | 后端类型检查 |
| `pnpm check:web` | 用 Vue 官方编译器校验所有 `.vue` 与 `.ts` |
| `pnpm smoke` | 端到端烟测（需服务已启动） |

### 11.2 烟测覆盖

`scripts/smoke.mjs` 共 47 项断言：

- 五模块列表
- 文章：创建 bundle、`published` 裸日期、含冒号描述加引号、tags inline、`seriesOrder: 0`、更新保留未提交字段、图片落到 `images/` 并返回相对引用、转 webp、长边限制
- 相册：创建目录 + 写配置、配置保留 import 与注释、照片上传/列表/设封面/删照片、删除相册连带目录、albumId 不可改
- 友链：追加/更新/删除，不破坏同文件的 `friendsPageConfig`
- 动态：自动时间戳 id、时间为裸字面值、更新不重命名文件
- 项目：`link[]` 完整 round-trip
- 安全：路径穿越被拒、未知类型 404
- 构建：触发、终态、日志可读

运行：

```powershell
$env:BASE='http://127.0.0.1:4310'; pnpm smoke
```

### 11.3 受限环境的前端构建验证

如果环境无法派生 esbuild 子进程（受限沙箱、某些 CI）：

```bash
node --import ./scripts/patch-register.mjs node_modules/vite/bin/vite.js build \
  --config vite.config.verify.mjs --configLoader runner
```

原理：

1. `--configLoader runner` —— 让 vite 用原生 import 加载配置，不走 esbuild 打包
2. `patch-register.mjs` 注册一个 ESM loader
3. loader 拦截 `node:child_process`，把 `exec`/`execFile` 换成空实现（vite 在 Windows 上会 `exec('net use')` 探测网盘）
4. loader 把裸模块 `esbuild` 换成纯 JS 垫片：`transform()` 只做 define 替换（**按 key 长度降序**，否则 `process.env` 会把 `process.env.NODE_ENV` 拆坏）、跳过压缩

正常环境完全不需要这套东西。

---

## 12. 排错

| 现象 | 原因 / 处理 |
|---|---|
| `未配置博客仓库路径` | 没复制 `admin.config.example.json`，或 `repoPath` 为空 |
| `repoPath 不存在` / `不是 Firefly 仓库` | 路径错，或缺 `astro.config.mjs` |
| `EADDRINUSE` | 端口被占，改 `admin.config.json` 的 `port` |
| `配置文件解析失败` | JSON 语法错（BOM 已被容错处理） |
| 点预览报 `找不到 Astro 可执行文件` | 博客仓库没装依赖，去仓库目录 `pnpm install` |
| 点构建报 `缺少 node_modules` | 同上 |
| 保存报 `frontmatter 校验失败` | 某字段序列化后类型漂移（通常是日期），按提示改 |
| 保存报 `图片引用不存在` | 只是 warning，说明正文引用了不存在的图，构建时该图 404 |
| 改了相册/友链页面没变 | dev 需重启，用【设置 → 重启 dev server】 |
| `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` | pnpm 12 默认拒绝安装发布不足 24h 的包；项目已带 `pnpm-workspace.yaml`（`minimumReleaseAge: 0`），仍报错就 `pnpm install --config.minimumReleaseAge=0` |
| bat 报 `'xxx' 不是内部或外部命令` | 旧版 bat 含中文，cmd 按 GBK 解析会拆坏命令；已改为纯 ASCII |
| 切换模块后列表不刷新 | 已修复（`ContentList` 监听 `route.params.type` 重新加载） |

---

## 13. 已知限制

| 限制 | 说明 | 可能的改进 |
|---|---|---|
| 单用户、无鉴权 | 只适合本机 | 若要异地使用需加登录 + 公网加固 |
| 无自动部署 | 手动上传 `dist/` | 可加 zip 打包 + FTP/PHP 解压 |
| 无草稿自动保存 | 只有手动保存 | 可加 `localStorage` 或 DB 草稿 |
| 无版本对比 | 靠 `git log` 回溯 | 可接 `git show` 展示 diff |
| 列表每次全量扫盘 | 13 篇文章几毫秒；上千篇会变慢 | 加 SQLite 索引 |
| 预览需本机跑 Astro | 依赖博客仓库的 `node_modules` | 无 |
| 不支持 MDX 语法体检 | 语法错误会在构建时暴露 | 可加 esbuild parse 预检 |
| 并发写同一文件无锁 | 单用户场景基本不触发 | 加进程内 mutex |

---

## 附录 A：字段定义总表

### 文章 post

| 字段 | 类型 | 必填 | 分组 | 说明 |
|---|---|---|---|---|
| title | string | ✅ | basic | |
| published | date | ✅ | basic | 裸日期 |
| updated | date | | display | |
| description | text | | basic | 首页卡片摘要 |
| image | image | | display | 支持 `./路径`、`/public路径`、`https`、`api` |
| tags | tags | | basic | |
| category | string | | basic | |
| draft | boolean | | basic | 新建默认 true |
| pinned | boolean | | display | |
| series | string | | display | 同名归组，必须完全一致 |
| seriesOrder | number | | display | 0 合法 |
| lang | string | | advanced | |
| author | string | | advanced | |
| comment | boolean | | advanced | |
| licenseName / licenseUrl | string | | advanced | |
| sourceLink | string | | advanced | |
| password / passwordHint | string | | security | 明文入 git，有风险提示 |

### 动态 moment

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| published | datetime | ✅ | `YYYY-MM-DD HH:mm:ss`，裸字面值 |
| pinned | boolean | | |
| location | string | | |

### 项目 project

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| title | string | ✅ | |
| published | date | ✅ | |
| draft | boolean | | |
| order | number | | 越小越靠前 |
| description | text | | |
| image | image | | |
| tags | tags | | |
| status | string | | 如 active / archived |
| link | links | | `{label, icon, value}[]` |
| lang | string | | |

### 相册 album

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| id | string | ✅ | 不可变，等于目录名 |
| name | string | ✅ | |
| description | text | | |
| date | string | | `YYYY-MM-DD` |
| location | string | | |
| tags | tags | | |
| cover | image | | 留空则用 `cover.*` 或第一张 |
| password / passwordHint | string | | |

### 友链 friend

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| title | string | ✅ | |
| imgurl | string | ✅ | 头像 URL |
| desc | string | ✅ | |
| siteurl | string | ✅ | |
| tags | tags | | |
| weight | number | ✅ | 越大越靠前 |
| enabled | boolean | | 停用而非删除 |

---

## 附录 B：设计决策记录

| 决策 | 理由 |
|---|---|
| **不自己渲染 Markdown** | 主题的管线有十几个插件，自研必然不一致。预览交给 `astro dev` |
| **不自动部署** | 链路最短、最少失败点；构建产物交给用户手动传 |
| **不用数据库存内容** | 内容真源必须在文件里，否则 Firefly 读不到。后台只为"操作"存在，不为"存储" |
| **元驱动而非五套代码** | 五个模块字段差异大但结构同构。注册表 + 三个 Writer 比五个 Service 好维护 |
| **写配置用 AST 文本区间替换** | 唯一能做到"只改值、其它字节不动"的方式，注释、import、类型注解都能保住 |
| **强制 round-trip 校验** | 本地后台没有 CI 兜底，`z.date()` 对字符串会直接让整站构建失败，必须在写入前拦住 |
| **后端用 tsc 编译而不是 tsx** | `tsx` 依赖 esbuild 子进程；`tsc` 是纯 JS，任何环境都能跑 |
| **bat 用纯 ASCII** | cmd 按系统 ANSI 解析批处理文件，UTF-8 中文会把命令行拆坏 |
| **pnpm-workspace.yaml 关掉 minimumReleaseAge** | pnpm 12 的默认策略会拒绝当天发布的包，rollup 平台包必中招 |
| **相册 id 用 albumId 而不是数组下标** | 下标会随排序/增删漂移，而详情/更新/删除都要按 albumId 定位；统一后前后端只认一种 id |
| **封面相对路径在后端补全** | Firefly 的 `withBase()` 把 `cover.jpg` 补成 `/cover.jpg`（站根），用户按直觉写相对路径必 404；在写入时规范化比在每个入口给提示更可靠 |
| **图片预览走 /repo-assets 而不是改内容里的路径** | 内容文件里的路径必须保持博客语义（`/gallery/...`）；转换只发生在展示层，不污染内容 |
