import type { FastifyInstance } from "fastify";
import type { UploadTarget, UploadTargetType } from "../../infra/media.ts";
import type { AppDeps } from "../../types.ts";

const VALID_TARGETS: UploadTargetType[] = ["post", "moment", "album", "media"];

/** @fastify/multipart 的 fields 值可能是 { value } 包装对象 */
function fieldValue(fields: Record<string, unknown>, key: string): string | undefined {
	const raw = fields[key];
	if (raw === undefined || raw === null) return undefined;
	if (typeof raw === "object" && "value" in (raw as Record<string, unknown>)) {
		const value = (raw as { value?: unknown }).value;
		return value === undefined || value === null ? undefined : String(value);
	}
	return String(raw);
}

function parseTarget(fields: Record<string, unknown>): UploadTarget {
	const type = (fieldValue(fields, "targetType") ?? "media") as UploadTargetType;
	if (!VALID_TARGETS.includes(type)) {
		throw Object.assign(new Error(`未知上传目标：${type}`), { statusCode: 400 });
	}
	return { type, id: fieldValue(fields, "targetId") };
}

export function mediaRoutes(deps: AppDeps) {
	return async (app: FastifyInstance): Promise<void> => {
		app.post("/upload", async (request, reply) => {
			if (!request.isMultipart()) {
				throw Object.assign(new Error("请使用 multipart/form-data 上传"), { statusCode: 400 });
			}
			const data = await request.file();
			if (!data) {
				throw Object.assign(new Error("没有收到文件"), { statusCode: 400 });
			}
			const buffer = await data.toBuffer();
			const target = parseTarget(data.fields as Record<string, unknown>);
			const result = await deps.media.processAndStore(target, {
				buffer,
				filename: data.filename,
			});
			reply.code(201);
			return result;
		});

		app.get("/uploads", async (request) => {
			const query = request.query as { dir?: string };
			const dir = query.dir || "public/assets/images/uploads";
			const items = await deps.media.listUploads(dir);
			return { dir, items };
		});
	};
}
