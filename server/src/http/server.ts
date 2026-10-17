import { existsSync } from "node:fs";
import path from "node:path";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { albumRoutes } from "./routes/albums.ts";
import { buildRoutes } from "./routes/build.ts";
import { contentRoutes } from "./routes/content.ts";
import { mediaRoutes } from "./routes/media.ts";
import { systemRoutes } from "./routes/system.ts";
import type { AppDeps } from "../types.ts";

export async function createServer(deps: AppDeps): Promise<FastifyInstance> {
	const app = Fastify({
		logger: {
			level: process.env.LOG_LEVEL || "info",
		},
		bodyLimit: 16 * 1024 * 1024,
	});

	await app.register(fastifyMultipart, {
		limits: {
			fileSize: deps.config.media.maxUploadBytes,
			files: 30,
		},
	});

	app.setErrorHandler((error: unknown, request, reply) => {
		const err = error as { message?: string; name?: string; statusCode?: number };
		const message = err.message ?? "未知错误";
		const status = err.statusCode ?? (err.name === "PathAccessError" ? 403 : message.startsWith("未找到") ? 404 : 500);
		request.log.error({ err }, "request failed");
		reply.code(status).send({ error: message });
	});

	await app.register(contentRoutes(deps), { prefix: "/api/content" });
	await app.register(mediaRoutes(deps), { prefix: "/api/media" });
	await app.register(albumRoutes(deps), { prefix: "/api/albums" });
	await app.register(buildRoutes(deps), { prefix: "/api/build" });
	await app.register(systemRoutes(deps), { prefix: "/api/system" });

	app.get("/api/health", async () => ({ ok: true, uptimeMs: Date.now() - deps.startedAt }));

	// 只读托管博客仓库的 public/ 目录，供后台预览图片（/gallery/**、/assets/images/** 等）
	// 注意：不要设 wildcard:false —— 那会在启动时按目录快照注册路由，
	// 之后新上传的、文件名含中文/空格的图片都会 404。
	const repoPublicDir = path.join(deps.config.repoPath, "public");
	if (existsSync(repoPublicDir)) {
		await app.register(fastifyStatic, {
			root: repoPublicDir,
			prefix: "/repo-assets/",
			// 第一个 static 实例不装饰 reply，留给下面托管前端的实例
			decorateReply: false,
			// 后台预览必须每次校验：换封面后文件名不变（仍叫 cover.webp），
			// 长缓存会让浏览器一直显示旧图
			cacheControl: true,
			maxAge: 0,
			etag: true,
			lastModified: true,
		});
	}

	// 生产模式：托管已构建的前端；开发模式由 vite dev server 提供
	if (existsSync(path.join(deps.webDistDir, "index.html"))) {
		await app.register(fastifyStatic, {
			root: deps.webDistDir,
			prefix: "/",
		});
		app.setNotFoundHandler((request, reply) => {
			const url = request.raw.url ?? "";
			if (url.startsWith("/api/")) {
				reply.code(404).send({ error: `接口不存在：${url}` });
				return;
			}
			// 仓库资源找不到就 404，不要回落到 index.html
			if (url.startsWith("/repo-assets/")) {
				reply.code(404).send({ error: "资源不存在" });
				return;
			}
			reply.sendFile("index.html");
		});
	} else {
		app.setNotFoundHandler((request, reply) => {
			const url = request.raw.url ?? "";
			if (url.startsWith("/api/")) {
				reply.code(404).send({ error: `接口不存在：${url}` });
				return;
			}
			if (url.startsWith("/repo-assets/")) {
				reply.code(404).send({ error: "资源不存在" });
				return;
			}
			reply
				.code(200)
				.type("text/html; charset=utf-8")
				.send(
					`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Columbina Admin</title>` +
						`<body style="font-family:system-ui;padding:40px;line-height:1.7;max-width:720px">` +
						`<h2>后台已启动，但前端尚未构建</h2>` +
						`<p>开发模式请访问 <a href="${deps.webDevUrl}">${deps.webDevUrl}</a>（<code>npm run dev</code>）。</p>` +
						`<p>生产模式请先执行 <code>npm run build</code>，生成 <code>web/dist</code> 后刷新本页。</p>` +
						`<p>健康检查：<a href="/api/health">/api/health</a></p>` +
						`</body></html>`,
				);
		});
	}

	return app;
}
