import { spawn } from "node:child_process";
import path from "node:path";
import { loadConfig } from "./config.ts";
import { ContentRepository } from "./content/repository.ts";
import { createServer } from "./http/server.ts";
import { MediaService } from "./infra/media.ts";
import { ProcessManager, type BuildStep } from "./infra/process.ts";
import type { AppDeps } from "./types.ts";

function defaultBuildSteps(): BuildStep[] {
	return [
		{
			label: "astro build",
			command: process.execPath,
			args: ["node_modules/astro/bin/astro.mjs", "build"],
		},
	];
}

function openBrowser(url: string): void {
	const command =
		process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
	const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
	try {
		spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
	} catch {
		/* 打不开就算了 */
	}
}

async function main(): Promise<void> {
	const config = await loadConfig();
	const webDistDir = path.resolve(process.cwd(), "web", "dist");

	const buildSteps = (config as unknown as { buildSteps?: BuildStep[] }).buildSteps ?? defaultBuildSteps();

	const deps: AppDeps = {
		config,
		repo: new ContentRepository(config),
		media: new MediaService(config),
		pm: new ProcessManager(config.repoPath, config.devPort, buildSteps),
		startedAt: Date.now(),
		webDistDir,
		webDevUrl: "http://localhost:5173",
	};

	const app = await createServer(deps);

	const shutdown = async (signal: string): Promise<void> => {
		app.log.info(`收到 ${signal}，正在关闭...`);
		try {
			await deps.pm.dispose();
		} catch {
			/* ignore */
		}
		await app.close();
		process.exit(0);
	};

	process.on("SIGINT", () => void shutdown("SIGINT"));
	process.on("SIGTERM", () => void shutdown("SIGTERM"));

	await app.listen({ host: config.host, port: config.port });

	const url = `http://${config.host === "0.0.0.0" ? "127.0.0.1" : config.host}:${config.port}`;
	const lines = [
		"",
		"  Columbina Admin 已启动",
		`  接口/前端：${url}`,
		`  博客仓库：${config.repoPath}`,
		`  dev 预览端口：${config.devPort}`,
		"",
	];
	console.log(lines.join("\n"));

	if (process.env.OPEN_BROWSER !== "0" && deps.config.port) {
		openBrowser(url);
	}
}

main().catch((error) => {
	console.error("[admin] 启动失败：", error);
	process.exit(1);
});
