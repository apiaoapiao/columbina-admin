import type { FastifyInstance } from "fastify";
import type { LogLine } from "../../infra/process.ts";
import type { AppDeps } from "../../types.ts";

export function buildRoutes(deps: AppDeps) {
	return async (app: FastifyInstance): Promise<void> => {
		app.get("/status", async () => {
			const { logTail, ...record } = deps.pm.buildSnapshot();
			return { ...record, recentLines: logTail.slice(-30) };
		});

		app.get("/log", async (request) => {
			const query = request.query as { count?: string };
			const count = Math.min(Number(query.count ?? 400) || 400, 2000);
			return { lines: deps.pm.buildLog.tail(count) };
		});

		app.post("/run", async () => {
			const running = deps.pm.buildSnapshot().status === "running";
			if (running) {
				return { started: false, message: "构建已在进行中" };
			}
			void deps.pm.runBuild();
			return { started: true };
		});

		app.post("/cancel", async () => {
			const cancelled = await deps.pm.cancelBuild();
			return { cancelled };
		});

		app.get("/events", (request, reply) => {
			reply.hijack();
			const raw = reply.raw;
			raw.writeHead(200, {
				"Content-Type": "text/event-stream; charset=utf-8",
				"Cache-Control": "no-cache, no-transform",
				Connection: "keep-alive",
				"X-Accel-Buffering": "no",
			});
			raw.write(": connected\n\n");

			for (const line of deps.pm.buildLog.tail(200)) {
				raw.write(`data: ${JSON.stringify(line)}\n\n`);
			}

			const unsubscribe = deps.pm.buildLog.subscribe((line: LogLine) => {
				raw.write(`data: ${JSON.stringify(line)}\n\n`);
			});

			const heartbeat = setInterval(() => {
				raw.write(": ping\n\n");
			}, 15_000);

			request.raw.on("close", () => {
				clearInterval(heartbeat);
				unsubscribe();
				try {
					raw.end();
				} catch {
					/* ignore */
				}
			});
		});
	};
}
