import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../../types.ts";

export function albumRoutes(deps: AppDeps) {
	return async (app: FastifyInstance): Promise<void> => {
		app.get("/:id/photos", async (request) => {
			const { id } = request.params as { id: string };
			const photos = await deps.repo.listPhotos(id);
			return { photos };
		});

		app.post("/:id/photos", async (request, reply) => {
			const { id } = request.params as { id: string };
			if (!request.isMultipart()) {
				throw Object.assign(new Error("请使用 multipart/form-data 上传"), { statusCode: 400 });
			}
			const uploaded: Array<Record<string, unknown>> = [];
			for await (const part of request.files()) {
				const buffer = await part.toBuffer();
				const result = await deps.media.processAndStore(
					{ type: "album", id },
					{ buffer, filename: part.filename },
				);
				uploaded.push({ ...result });
			}
			reply.code(201);
			return { uploaded };
		});

		app.delete("/:id/photos/:name", async (request) => {
			const { id, name } = request.params as { id: string; name: string };
			return deps.repo.deletePhoto(id, decodeURIComponent(name));
		});

		app.post("/:id/cover", async (request) => {
			const { id } = request.params as { id: string };
			const body = (request.body ?? {}) as { name?: string };
			if (!body.name) {
				throw Object.assign(new Error("缺少参数 name"), { statusCode: 400 });
			}
			return deps.repo.setCover(id, body.name);
		});
	};
}
