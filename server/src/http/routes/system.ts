import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { CONTENT_TYPES } from "../../content/registry.ts";
import { gitLog, gitStatus } from "../../infra/git.ts";
import type { AppDeps } from "../../types.ts";

export function systemRoutes(deps: AppDeps) {
	return async (app: FastifyInstance): Promise<void> => {
		app.get("/status", async () => {
			const [git, dev] = await Promise.all([
				gitStatus(deps.config.repoPath),
				Promise.resolve(deps.pm.devStatus()),
			]);
			const { logTail, ...record } = deps.pm.buildSnapshot();
			return {
				repoPath: deps.config.repoPath,
				port: deps.config.port,
				devPort: deps.config.devPort,
				uptimeMs: Date.now() - deps.startedAt,
				git,
				dev,
				build: record,
				webDistDir: deps.webDistDir,
				hasWebBuild: existsSync(path.join(deps.webDistDir, "index.html")),
			};
		});

		app.get("/meta", async () => {
			return {
				types: Object.values(CONTENT_TYPES).map((def) => ({
					key: def.key,
					label: def.label,
					kind: def.kind,
					idLabel: def.idLabel,
					titleField: def.titleField,
					dateField: def.dateField,
					hasBody: def.hasBody,
					fields: def.fields,
					listFields: def.listFields,
					hint: def.hint,
					configFile: def.configFile,
					root: def.root,
				})),
				media: deps.config.media,
			};
		});

		app.post("/restart-dev", async () => {
			const { url } = await deps.pm.restartDev();
			return { ok: true, url };
		});

		app.post("/start-dev", async () => {
			const { url, restarted } = await deps.pm.ensureDev();
			return { ok: true, url, restarted };
		});

		app.post("/stop-dev", async () => {
			await deps.pm.stopDev();
			return { ok: true };
		});

		app.get("/git-log", async (request) => {
			const query = request.query as { limit?: string };
			const limit = Math.min(Number(query.limit ?? 20) || 20, 100);
			const entries = await gitLog(deps.config.repoPath, limit);
			return { entries };
		});

		app.post("/open-dist", async () => {
			const distDir = path.join(deps.config.repoPath, "dist");
			if (!existsSync(distDir)) {
				throw Object.assign(new Error("dist 目录不存在，请先构建"), { statusCode: 404 });
			}
			const command =
				process.platform === "win32" ? "explorer" : process.platform === "darwin" ? "open" : "xdg-open";
			try {
				spawn(command, [distDir], { detached: true, stdio: "ignore", windowsHide: true }).unref();
			} catch (error) {
				throw new Error(`无法打开目录：${(error as Error).message}`);
			}
			return { ok: true, dir: distDir };
		});
	};
}
