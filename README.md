# Columbina Admin

给 [Firefly](https://github.com/CuteLeaf/Firefly) 博客用的**本地后台管理系统**。

它不改造博客、不新增数据库、不接管部署：直接读写你本地 Firefly 仓库里的 **Markdown 文件、相册目录、TS 配置数组**，改完在本地构建，产物照你原来的方式手动上传到虚拟主机。

> 📘 **完整技术文档见 [`docs/PROJECT.md`](docs/PROJECT.md)**（架构、写入管线、预览实现、API 参考、设计决策）
> 本文只讲怎么用。

```
浏览器 (Vue3 + Element Plus)
        ↓ HTTP / SSE
Fastify 服务（127.0.0.1）
        ↓ 文件读写（白名单）
F:\your-blog\src\content\**      文章 / 动态 / 项目
F:\your-blog\public\gallery\**   相册照片
F:\your-blog\src\config\*.ts     相册、友链（只改值）
```

---

## 一、快速开始

### 1. 环境

- **Node.js ≥ 20.11**（推荐 22）
- **pnpm**（推荐；`corepack enable` 或 `npm install -g pnpm`），用 npm 也能跑
- 已能正常构建的 Firefly 仓库（即仓库里装过依赖，存在 `node_modules`）

### 2. 安装并配置

```bash
cd firefly-admin
pnpm install
```

复制配置样例：

```bash
copy admin.config.example.json admin.config.json
```

编辑 `admin.config.json`，**只需改这一行**：

```json
{
  "repoPath": "F:/Firefly-master/Firefly-master"
}
```

### 3. 启动

**推荐：双击 `start-admin.bat`**。它会依次检查依赖 → 检查配置（缺了就打开记事本让你填）→ 编译后端 → 构建前端 → 启动服务。脚本直接调用 `node_modules` 里的 `tsc` / `vite`，**不经过 pnpm/npm 的脚本系统**，因此不会被包管理器的策略或版本问题卡住。

手动等价流程：

```bash
node node_modules/typescript/bin/tsc -p tsconfig.server.json
node node_modules/vite/bin/vite.js build
node dist-server/index.js
```

浏览器会自动打开 `http://127.0.0.1:4310`。

> 编译后端 + 构建前端约 10~20 秒。产物分别是 `dist-server/` 和 `web/dist/`，都在 `.gitignore` 里。
> 运行期数据放在项目根目录 `data/`（事务快照、日志）。

---

## 二、配置项

`admin.config.json`（修改后需重启后台）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `repoPath` | — | **必填**，Firefly 仓库绝对路径 |
| `host` | `127.0.0.1` | 不要改成 `0.0.0.0`，否则同局域网可访问你的后台 |
| `port` | `4310` | 后台端口 |
| `devPort` | `4321` | `astro dev` 预览端口 |
| `gitCommit` | `true` | 每次写入后自动 `git commit`，便于回滚 |
| `autoRestartDevOnConfigChange` | `true` | 改配置文件后自动重启 dev |
| `media.maxEdge` | `2560` | 上传图片长边上限（px） |
| `media.webpQuality` | `82` | webp 质量 |
| `media.convertToWebp` | `true` | 是否统一转 webp；`false` 时保留 jpg |
| `buildSteps` | 见下 | 自定义构建命令 |

### 关于 buildSteps

默认只跑 `astro build`（快，够本地预览）：

```json
"buildSteps": [
  { "label": "astro build", "command": "node", "args": ["node_modules/astro/bin/astro.mjs", "build"] }
]
```

如果你希望后台点「构建站点」产出**可直接上线的完整 dist**（含 LQIP、字体子集、Pagefind 搜索索引），改成走博客自己的构建脚本：

```json
"buildSteps": [
  { "label": "full build", "command": "pnpm", "args": ["build"] }
]
```

> Windows 上 `pnpm` 是 `.cmd`，后台已经对 `.cmd` 自动加 `shell: true`。

---

## 三、五个模块

| 模块 | 写入位置 | 说明 |
|---|---|---|
| **文章** | `src/content/posts/<slug>/index.md` + `images/` | bundle 形式，图片跟文章走 |
| **动态** | `src/content/dynamic/<时间戳>.md` | 文件名即 URL，编辑时间不会重命名 |
| **项目** | `src/content/projects/<slug>.md` | frontmatter + README 正文 |
| **相册** | `public/gallery/<albumId>/` + `src/config/galleryConfig.ts` 的 `albums` | 照片目录 + 配置数组双写 |
| **友链** | `src/config/friendsConfig.ts` 的 `friendsConfig` 数组 | 停用请设 `enabled: false` |

### 几个已经替你处理掉的坑

- **日期不加引号**：`published: 2025-12-01`（加了引号就是字符串，会触发 `z.date()` 校验失败、整站构建失败）。后台写入前会做 round-trip 校验，类型漂移直接拒绝保存。
- **含冒号/井号的字符串自动加引号**：`description: "含冒号: 的内容"`。
- **字段顺序固定**：每次保存的 git diff 只包含真实改动。
- **TS 配置只替换数组区间的文本**：`import`、注释、类型注解、其它字段原样保留；改写后做语法校验，失败自动回滚。
- **删除文章连带删图片目录**；删除相册连带删配置项和照片目录。
- **相册 ID 不可修改**（改了就断链），封面通过把文件重命名为 `cover.*` 实现，与主题规则天然对齐。
- **图片上传**：EXIF（含 GPS）剥离、按 EXIF 方向自动摆正、长边限制、转 webp、SHA256 去重。

---

## 四、预览、构建与部署

### 预览

编辑页点「预览」/「保存并预览」：

1. 后台按需启动 `astro dev`（首次约 5~15 秒，之后复用）
2. 抽屉里用 iframe 展示 `http://localhost:4321/<对应路由>`

**预览 = 主题真实渲染**（Mermaid、Callout、KaTeX、代码块全部生效），不是自己写的一套 Markdown 渲染。

注意：dev 模式下 Pagefind 搜索索引不存在（那是构建产物），所以别在预览里验收搜索。

### 构建

顶部「构建站点」→ 抽屉里实时看日志（SSE 推送）。构建成功后产物在博客仓库的 `dist/`，点「设置 → 打开 dist 目录」可直接打开。

### 部署（手动）

用你习惯的方式（FTP / 主机面板 / FileZilla）把 `dist/` 整个上传覆盖到虚拟主机站点根目录即可。

> `dist/` 里有上千个小文件，建议**打包成 zip 上传后在主机面板解压**，比逐文件 FTP 快很多，也不容易传到一半断掉。

---

## 五、目录结构

```
firefly-admin/
├─ admin.config.example.json
├─ start-admin.bat            一键启动
├─ package.json
├─ tsconfig.json              前端 TS
├─ tsconfig.server.json       后端 TS（编译到 dist-server）
├─ vite.config.mjs
├─ public/assets/images/       前端静态资源（站点图标等）
├─ scripts/
│  ├─ check-web.mjs           单独校验所有 .vue / .ts 能否编译
│  └─ smoke.mjs               端到端烟测
├─ server/src/
│  ├─ index.ts                启动入口
│  ├─ config.ts               读 admin.config.json
│  ├─ content/
│  │  ├─ registry.ts          五个内容类型的字段定义（唯一真源）
│  │  ├─ frontmatter.ts       YAML 序列化 + round-trip 校验
│  │  ├─ ts-array.ts          TS 配置数组的 AST 读写
│  │  └─ repository.ts        ContentRepository（唯一文件入口）
│  ├─ infra/
│  │  ├─ paths.ts             路径白名单与安全校验
│  │  ├─ fsx.ts               原子写、事务快照
│  │  ├─ git.ts               git 提交（失败不阻断）
│  │  ├─ media.ts             sharp 图片管线
│  │  └─ process.ts           astro dev / build 子进程管理
│  └─ http/
│     ├─ server.ts            Fastify 装配
│     └─ routes/              content / media / albums / build / system
└─ web/src/
   ├─ api.ts  store.ts  router.ts  App.vue
   ├─ components/  FieldInput.vue、MarkdownEditor.vue
   └─ pages/       Dashboard、ContentList、ContentEditor、AlbumDetail、MediaLibrary、Settings
```

---

## 六、接口一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/system/meta` | 五种类型的字段定义（前端表单据此渲染） |
| GET | `/api/system/status` | 仓库路径、git 状态、dev 状态、构建状态 |
| POST | `/api/system/start-dev` / `restart-dev` / `stop-dev` | 预览服务 |
| POST | `/api/system/open-dist` | 打开 `dist` 目录 |
| GET | `/api/content/:type` | 列表 |
| GET | `/api/content/:type/:id` | 详情 |
| POST | `/api/content/:type` | 新建 |
| PUT | `/api/content/:type/:id` | 更新 |
| DELETE | `/api/content/:type/:id` | 删除 |
| POST | `/api/media/upload` | 上传图片（multipart：`file` + `targetType` + `targetId`） |
| GET | `/api/albums/:id/photos` | 相册照片 |
| POST | `/api/albums/:id/photos` | 批量上传照片 |
| POST | `/api/albums/:id/cover` | 设封面 |
| DELETE | `/api/albums/:id/photos/:name` | 删照片 |
| POST | `/api/build/run` / `cancel` | 触发 / 取消构建 |
| GET | `/api/build/status` / `log` / `events` | 状态 / 日志 / SSE 实时流 |

---

## 七、安全边界

- 服务只监听 `127.0.0.1`，不对外暴露；没有账号体系（本机即权限）。
- **写操作白名单**（其余一律 403）：
  `src/content/{posts,dynamic,projects,spec}/**`、`public/gallery/**`、`public/assets/images/**`、`src/config/galleryConfig.ts`、`src/config/friendsConfig.ts`
- 拒绝 `..`、绝对路径、Windows 保留名；`slug` / `albumId` 只允许小写字母数字连字符。
- `admin.config.json` 已在 `.gitignore`（可能含路径信息），别忘了 `admin.config.example.json` 是给克隆者的模板。

⚠️ **文章密码是明文写进 Markdown 的**（Firefly 的加密机制决定），因此也会进入 git 历史。公开仓库不要用真实密码，界面里已做醒目提示。

---

## 八、排错

| 现象 | 原因 / 处理 |
|---|---|
| `pnpm install` 报 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` | pnpm 12 起默认拒绝安装发布时间不足 24 小时的包（`minimumReleaseAge = 1440`），rollup 的平台二进制包经常中招。项目根已带 `pnpm-workspace.yaml`（`minimumReleaseAge: 0`）自动放宽；若仍报错，执行 `pnpm install --config.minimumReleaseAge=0`，或降级：`corepack prepare pnpm@11.22.0 --activate` |
| 双击 bat 出现 `'xxx' 不是内部或外部命令` | 早期版本的 bat 是 UTF-8 中文，cmd 按 GBK 解析会把命令行拆坏。已改为纯英文脚本，请使用最新版 |
| 启动报 `未配置博客仓库路径` | 没复制 `admin.config.example.json`，或 `repoPath` 为空 |
| 启动报 `repoPath 不存在` / `不是 Firefly 仓库` | 路径写错，或该目录缺 `astro.config.mjs` |
| 启动报 `EADDRINUSE` | 端口被占，改 `admin.config.json` 的 `port` |
| 点预览报 `找不到 Astro 可执行文件` | 博客仓库没装依赖，去仓库目录执行 `pnpm install` |
| 点构建报 `缺少 node_modules` | 同上 |
| 保存后页面没变化 | 预览是 dev 实时读文件的；线上需要重新构建 + 上传 `dist` |
| 改了相册/友链但页面没变 | 改 `src/config/*.ts` 后 dev 需要重启，用「设置 → 重启 dev server」 |
| 保存报 `frontmatter 校验失败` | 某个字段序列化后类型变了（通常是日期格式），按提示改格式 |
| 保存报 `图片引用不存在` | 只是警告，说明正文里引用了不存在的图片，构建时该图会 404 |
| 点"编辑相册信息"报 `未找到相册：0` | 已修复（列表返回的 `id` 之前是数组下标，现统一为 albumId） |
| 编辑页里的图片显示不出来 | 已修复（后台新增 `/repo-assets/` 只读托管博客 `public/`，表单图片走它预览）。`./相对路径` 无法预览，属预期 |
| 相册封面设置了不生效 | 封面必须以 `/` 开头（如 `/gallery/<id>/cover.webp`）。填 `cover.jpg` 会自动补成 `/gallery/<albumId>/cover.jpg`，重新保存一次即可 |
| 相册里部分照片不显示（中文名、或刚上传的） | 已修复（`@fastify/static` 之前设了 `wildcard: false`，会在启动时按目录快照注册路由，导致之后新增的文件和中文/空格文件名 404） |
| 设为封面后显示的还是旧图 | 已修复（现在重命名文件的同时会同步更新 `galleryConfig` 的 `cover`，否则配置里的旧路径优先级更高） |
| 换封面后原来的封面图不见了 | 已修复（旧封面会归档成 `cover-<时间戳>.<ext>` 保留在相册里，不会再被当成封面） |
| 新建相册时传封面报"需要提供 albumId" | 已修复（新建时封面统一上传到 `public/gallery/_covers/`，不会提前创建相册目录） |
| 换封面后编辑页还是显示旧封面 | 已修复（`/repo-assets/` 改为 `max-age=0`，并给图片 URL 加 `?v=<mtime>`，同名文件内容变了也会重新加载） |
| 切换模块后列表还是上一个模块的内容 | 已修复（`ContentList` 监听 `route.params.type` 重新加载） |

---

## 九、开发

```bash
pnpm dev           # 后端(4310) + vite(5173) 并行，前端改代码热更新
pnpm build         # 编译后端 + 构建前端
pnpm typecheck     # 后端类型检查
pnpm check:web     # 用 Vue 官方编译器校验所有 .vue / .ts
pnpm smoke         # 端到端烟测（需服务已启动）
```

烟测会临时往仓库里写测试文章/相册/友链/动态/项目，跑完自动清理（`KEEP=1` 可保留）。

**PowerShell：**

```powershell
$env:BASE='http://127.0.0.1:4310'; pnpm smoke
```

（后端改了代码后需要重新 `pnpm build:server`；`pnpm dev` 里已经包含这一步。）

### 验证手段

| 命令 | 验证什么 |
|---|---|
| `pnpm check:web` | 用 Vue 官方编译器逐个编译 `.vue`（模板 + `<script setup>`），不依赖 vite/esbuild |
| `pnpm smoke` | 47 项端到端断言：五模块 CRUD、frontmatter 序列化规则（日期裸值/引号/tags/links）、TS 配置 AST 改写、图片管线、路径安全、构建触发 |
| `pnpm typecheck` | 后端类型检查 |

如果你在**无法派生 esbuild 子进程**的环境（受限沙箱、某些 CI）里想验证前端能否打包，可以用仓库里附带的兜底配置（正常环境完全不需要）：

```bash
node --import ./scripts/patch-register.mjs node_modules/vite/bin/vite.js build \
  --config vite.config.verify.mjs --configLoader runner
```

它会用 TypeScript 编译器替代 esbuild 做转译、跳过压缩，只验证"所有模块能解析、SFC 能编译、产物能生成"。

---

## 十、设计取舍（为什么这么做）

- **不碰博客源码结构**：只写内容文件与配置里"值"的部分，`astro.config.mjs`、`src/pages`、`components`、`utils` 一律只读。
- **不自己渲染 Markdown**：预览交给 `astro dev`，避免"后台好看、上线翻车"。
- **不做自动部署**：构建产物交给你手动传，链路最短、最少出错。
- **元驱动**：五个模块的字段定义集中在一处（`content/registry.ts`），加新类型只需加一个描述符。
- **写入必经管线**：路径白名单 → 事务快照 → 序列化 → 校验（round-trip / 图片引用 / TS 语法）→ 原子写 → git commit，失败即回滚。
