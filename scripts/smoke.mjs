/**
 * 端到端烟测：覆盖五个模块 CRUD、frontmatter 序列化、TS 配置改写、图片上传、构建触发。
 * 用法：node scripts/smoke.mjs    （需先启动后台，默认 http://127.0.0.1:4310）
 * 环境变量：BASE、SKIP_BUILD=1、KEEP=1
 */
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import sharp from "sharp";

const BASE = process.env.BASE || "http://127.0.0.1:4310";
const SKIP_BUILD = process.env.SKIP_BUILD === "1";
const KEEP = process.env.KEEP === "1";

let pass = 0;
let fail = 0;
const problems = [];
let REPO = "";

function ok(name, extra = "") {
	pass++;
	console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`);
}
function bad(name, detail) {
	fail++;
	problems.push(`${name}: ${detail}`);
	console.log(`  FAIL  ${name} — ${detail}`);
}
function check(name, condition, detail = "") {
	if (condition) ok(name, detail);
	else bad(name, detail || "断言失败");
}
function repoPath(rel) {
	return `${REPO}/${rel}`;
}
function readRepo(rel) {
	return readFileSync(repoPath(rel), "utf8");
}

function cleanDir(dir) {
	if (!existsSync(dir)) return;
	for (const entry of readdirSync(dir)) {
		rmSync(`${dir}/${entry}`, { recursive: true, force: true });
	}
}

async function req(method, path, body) {
	const res = await fetch(`${BASE}${path}`, {
		method,
		headers: body ? { "Content-Type": "application/json" } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	});
	const text = await res.text();
	let data;
	try {
		data = text ? JSON.parse(text) : {};
	} catch {
		data = { raw: text };
	}
	if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${data.error ?? text}`);
	return data;
}

async function upload(targetType, targetId, buffer, filename) {
	const form = new FormData();
	form.append("targetType", targetType);
	if (targetId) form.append("targetId", targetId);
	form.append("file", new Blob([buffer], { type: "image/jpeg" }), filename);
	const res = await fetch(`${BASE}/api/media/upload`, { method: "POST", body: form });
	const data = await res.json();
	if (!res.ok) throw new Error(data.error ?? "上传失败");
	return data;
}

async function makeJpeg(width, height, color) {
	return sharp({ create: { width, height, channels: 3, background: color } })
		.jpeg({ quality: 80 })
		.toBuffer();
}

console.log("\n=== 1. 系统状态 ===");
const status = await req("GET", "/api/system/status");
REPO = status.repoPath.replace(/\\/g, "/");
check("repoPath", REPO.length > 0, REPO);
check("build 状态字段", typeof status.build.status === "string", status.build.status);
const meta = await req("GET", "/api/system/meta");
check("meta 五种类型", meta.types.length === 5, meta.types.map((t) => t.key).join(","));

console.log("\n=== 2. 列表 ===");
for (const type of ["post", "moment", "project", "album", "friend"]) {
	const data = await req("GET", `/api/content/${type}`);
	check(`list ${type}`, Array.isArray(data.items), `${data.items.length} 条`);
}

console.log("\n=== 3. 文章 CRUD ===");
const postId = "admin-smoke-test";
await req("DELETE", `/api/content/post/${postId}`).catch(() => {});
await req("POST", "/api/content/post", {
	id: postId,
	fields: {
		title: "后台冒烟测试：中文标题",
		published: "2025-12-01",
		description: "含冒号: 井号 # 方括号 [x]",
		tags: ["测试", "C#"],
		category: "测试分类",
		draft: true,
		seriesOrder: 0,
	},
	body: "正文。\n\n```mermaid\ngraph TD\n A-->B\n```\n",
});
check("create post", existsSync(repoPath(`src/content/posts/${postId}/index.md`)));
const postRaw = readRepo(`src/content/posts/${postId}/index.md`);
check("published 裸日期", /^published: 2025-12-01$/m.test(postRaw));
check("描述自动加引号", /^description: ".*"/m.test(postRaw));
check("tags inline", /^tags: \[.*\]$/m.test(postRaw));
check("seriesOrder 数字", /^seriesOrder: 0$/m.test(postRaw));
await req("PUT", `/api/content/post/${postId}`, { fields: { title: "已更新标题" }, body: "新正文。\n" });
const postRaw2 = readRepo(`src/content/posts/${postId}/index.md`);
check("update 生效", postRaw2.includes("已更新标题"));
check("update 保留其他字段", postRaw2.includes("category: 测试分类"));

// 文章配图上传
const postImage = await upload("post", postId, await makeJpeg(1200, 800, { r: 90, g: 140, b: 220 }), "cover.jpg");
check("文章图片落到 bundle images/", postImage.relPath.startsWith(`src/content/posts/${postId}/images/`), postImage.relPath);
check("返回相对引用", postImage.reference.startsWith("./images/"), postImage.reference);
check("转换为 webp", postImage.relPath.endsWith(".webp"), postImage.relPath);
check("长边被限制", Math.max(postImage.width, postImage.height) <= 2560, `${postImage.width}x${postImage.height}`);

console.log("\n=== 4. 相册 CRUD + 照片 ===");
await req("DELETE", "/api/content/album/smoke-album").catch(() => {});
const album = await req("POST", "/api/content/album", {
	id: "smoke-album",
	fields: { name: "冒烟相册", description: "含冒号: 描述", date: "2025-12-02", tags: ["测试"] },
});
check("create album", existsSync(repoPath("public/gallery/smoke-album")));
const galleryRaw = readRepo("src/config/galleryConfig.ts");
check("配置写入", galleryRaw.includes("smoke-album"));
check("配置保留 import", galleryRaw.startsWith("import type { GalleryConfig }"));
check("配置保留注释", galleryRaw.includes("//"));

// 回归：list 返回的 id 必须是 albumId，不能是数组下标，否则编辑页会「未找到相册」
const albumList = await req("GET", "/api/content/album");
const listedAlbum = albumList.items.find((x) => x.fields.id === "smoke-album");
check("list 的 id 等于 albumId（不是下标）", listedAlbum?.id === "smoke-album", listedAlbum?.id);
const albumDoc = await req("GET", `/api/content/album/${album.id}`);
check("按 albumId 读取相册", albumDoc.doc.fields.id === "smoke-album");

// 回归：封面填相对路径应被补全成 /gallery/<albumId>/...
await req("PUT", `/api/content/album/${album.id}`, { fields: { cover: "cover.jpg" } });
check(
	"cover 相对路径被补全为站点路径",
	readRepo("src/config/galleryConfig.ts").includes("/gallery/smoke-album/cover.jpg"),
);

const photoA = await upload("album", "smoke-album", await makeJpeg(900, 600, { r: 220, g: 120, b: 90 }), "a.jpg");
const photoB = await upload("album", "smoke-album", await makeJpeg(900, 600, { r: 90, g: 220, b: 120 }), "b.jpg");
check("相册图片落盘", existsSync(repoPath("public/gallery/smoke-album")));
let photos = (await req("GET", "/api/albums/smoke-album/photos")).photos;
check("照片列表 2 张", photos.length === 2, `${photos.length}`);
check(
	"照片带 mtime（用于缓存击穿）",
	photos.every((p) => typeof p.mtime === "number" && p.mtime > 0),
);
await req("POST", "/api/albums/smoke-album/cover", { name: photos[0].name });
photos = (await req("GET", "/api/albums/smoke-album/photos")).photos;
check("设封面成功", photos.some((p) => p.isCover), photos.map((p) => p.name).join(","));
check("封面文件名规范", photos.filter((p) => p.isCover).every((p) => /^cover\./i.test(p.name)));
// 回归：设为封面必须同步写 galleryConfig 的 cover（Firefly 里配置优先于 cover.* 文件）
check(
	"设封面同步写入 cover 配置",
	/cover:\s*"\/gallery\/smoke-album\/cover\./.test(readRepo("src/config/galleryConfig.ts")),
);

// 回归：换封面时旧封面必须归档保留，不能被删除
const countBeforeSwitch = photos.length;
const nextCoverSource = photos.find((p) => !p.isCover);
await req("POST", "/api/albums/smoke-album/cover", { name: nextCoverSource.name });
photos = (await req("GET", "/api/albums/smoke-album/photos")).photos;
check("换封面后照片总数不减", photos.length === countBeforeSwitch, `${photos.length} vs ${countBeforeSwitch}`);
check(
	"旧封面被归档保留",
	photos.some((p) => /^cover-\d{8}-\d{6}/i.test(p.name)),
	photos.map((p) => p.name).join(","),
);
check("归档后的旧封面不再算封面", photos.filter((p) => p.isCover).length === 1);

// 新建相册时可能还没填 albumId：上传应落到独立封面目录而不是报错
const orphanCover = await upload("album", undefined, await makeJpeg(400, 300, { r: 10, g: 190, b: 10 }), "only-cover.jpg");
check("无 albumId 上传落到 _covers", orphanCover.relPath.startsWith("public/gallery/_covers/"), orphanCover.relPath);
check("返回 _covers 引用", orphanCover.reference.startsWith("/gallery/_covers/"), orphanCover.reference);

const toDelete = photos.find((p) => !p.isCover);
await req("DELETE", `/api/albums/smoke-album/photos/${encodeURIComponent(toDelete.name)}`);
photos = (await req("GET", "/api/albums/smoke-album/photos")).photos;
check("删除照片", photos.length === countBeforeSwitch - 1, `${photos.length}`);
cleanDir(repoPath("public/gallery/_covers"));
await req("DELETE", `/api/content/album/${album.id}`);
check("删除相册连同目录", !existsSync(repoPath("public/gallery/smoke-album")));
check("配置已移除", !readRepo("src/config/galleryConfig.ts").includes("smoke-album"));

console.log("\n=== 5. 友链 CRUD ===");
const friend = await req("POST", "/api/content/friend", {
	fields: {
		title: "冒烟友链",
		imgurl: "https://example.com/a.png",
		desc: "描述: 含冒号",
		siteurl: "https://example.com",
		tags: ["测试"],
		weight: 9,
		enabled: true,
	},
});
check("create friend", readRepo("src/config/friendsConfig.ts").includes("冒烟友链"));
check("未破坏 friendsPageConfig", readRepo("src/config/friendsConfig.ts").includes("export const friendsPageConfig"));
await req("PUT", `/api/content/friend/${friend.id}`, { fields: { weight: 3 } });
check("友链更新", /weight: 3/.test(readRepo("src/config/friendsConfig.ts")));
await req("DELETE", `/api/content/friend/${friend.id}`);
check("友链删除", !readRepo("src/config/friendsConfig.ts").includes("冒烟友链"));

console.log("\n=== 6. 动态 CRUD ===");
const moment = await req("POST", "/api/content/moment", {
	fields: { published: "2025-12-03 10:20:30", pinned: false, location: "测试地" },
	body: "测试动态。\n",
});
const momentPath = `src/content/dynamic/${moment.id}.md`;
check("create moment", existsSync(repoPath(momentPath)));
check("时间为裸字面值", /^published: 2025-12-03 10:20:30$/m.test(readRepo(momentPath)));
await req("PUT", `/api/content/moment/${moment.id}`, { fields: { location: "改过" } });
check("更新不重命名文件", existsSync(repoPath(momentPath)));
check("位置已更新", readRepo(momentPath).includes("改过"));
await req("DELETE", `/api/content/moment/${moment.id}`);
check("删除动态", !existsSync(repoPath(momentPath)));

console.log("\n=== 7. 项目 CRUD（link 数组）===");
const projectId = "smoke-project";
await req("DELETE", `/api/content/project/${projectId}`).catch(() => {});
await req("POST", "/api/content/project", {
	id: projectId,
	fields: {
		title: "冒烟项目",
		published: "2025-12-04",
		description: "简介",
		tags: ["工具"],
		status: "active",
		link: [
			{ label: "GitHub", icon: "fa7-brands:github", value: "https://github.com/x/y" },
			{ label: "Demo", icon: "", value: "https://demo.example.com" },
		],
	},
	body: "# 冒烟项目\n",
});
const projectBack = await req("GET", `/api/content/project/${projectId}`);
check("link round-trip", projectBack.doc.fields.link?.length === 2, JSON.stringify(projectBack.doc.fields.link));
await req("DELETE", `/api/content/project/${projectId}`);
check("删除项目", !existsSync(repoPath(`src/content/projects/${projectId}.md`)));

console.log("\n=== 8. 安全边界 ===");
try {
	await req("GET", "/api/content/post/..%2F..%2Fastro.config.mjs");
	bad("路径穿越", "居然成功了");
} catch (error) {
	check("路径穿越被拒绝", true, error.message.slice(0, 50));
}
try {
	await req("GET", "/api/content/unknown");
	bad("未知类型", "居然成功了");
} catch (error) {
	check("未知类型被拒绝", true, error.message.slice(0, 50));
}

console.log("\n=== 9. 构建触发 ===");
if (SKIP_BUILD) {
	console.log("  SKIP  （SKIP_BUILD=1）");
} else {
	const run = await req("POST", "/api/build/run");
	check("构建已启动", run.started === true || run.message, run.message ?? "started");
	let record = null;
	for (let i = 0; i < 120; i++) {
		await new Promise((r) => setTimeout(r, 1000));
		record = await req("GET", "/api/build/status");
		if (record.status !== "running") break;
	}
	check("构建任务有终态", record && record.status !== "running", record?.status);
	console.log(`        构建状态=${record?.status} 用时=${record?.durationMs}ms`);
	if (record?.status === "failed") {
		console.log(`        预期内失败（fixture 无 node_modules）：${String(record.error).slice(0, 80)}`);
	}
	const log = await req("GET", "/api/build/log?count=50");
	check("构建日志可读", Array.isArray(log.lines) && log.lines.length > 0, `${log.lines.length} 行`);
}

console.log("\n=== 10. 清理 ===");
if (KEEP) {
	console.log("  SKIP  （KEEP=1）");
} else {
	await req("DELETE", `/api/content/post/${postId}`).catch(() => {});
	check("测试文章已清理", !existsSync(repoPath(`src/content/posts/${postId}`)));
}

console.log(`\n结果：PASS=${pass} FAIL=${fail}`);
if (problems.length > 0) {
	console.log("失败项：");
	for (const item of problems) console.log(`  - ${item}`);
	process.exit(1);
}
