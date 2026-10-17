import type { FastifyInstance } from "fastify";
import type { ContentTypeKey } from "../../content/registry.ts";
import { isContentTypeKey } from "../../content/registry.ts";
import type { AppDeps } from "../../types.ts";

function asType(value: string): ContentTypeKey {
	if (!isContentTypeKey(value)) {
		throw Object.assign(new Error(`未知内容类型：${value}`), { statusCode: 404 });
	}
	return value;
}

export function contentRoutes(deps: AppDeps) {
	return async (app: FastifyInstance): Promise<void> => {
		app.get("/:type", async (request) => {
			const { type } = request.params as { type: string };
			const items = await deps.repo.list(asType(type));
			return { items };
		});

		app.get("/:type/:id", async (request) => {
			const { type, id } = request.params as { type: string; id: string };
			const doc = await deps.repo.read(asType(type), decodeURIComponent(id));
			return { doc };
		});

		app.post("/:type", async (request, reply) => {
			const { type } = request.params as { type: string };
			const body = (request.body ?? {}) as {
				id?: string;
				fields?: Record<string, unknown>;
				body?: string;
			};
			const result = await deps.repo.create(asType(type), {
				id: body.id,
				fields: body.fields ?? {},
				body: body.body ?? "",
			});
			reply.code(201);
			return result;
		});

		app.put("/:type/:id", async (request) => {
			const { type, id } = request.params as { type: string; id: string };
			const body = (request.body ?? {}) as {
				fields?: Record<string, unknown>;
				body?: string;
			};
			return deps.repo.update(asType(type), decodeURIComponent(id), {
				fields: body.fields ?? {},
				body: body.body,
			});
		});

		app.delete("/:type/:id", async (request) => {
			const { type, id } = request.params as { type: string; id: string };
			return deps.repo.remove(asType(type), decodeURIComponent(id));
		});
	};
}
