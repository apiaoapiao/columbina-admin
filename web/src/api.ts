import axios from "axios";

export const http = axios.create({ baseURL: "/api", timeout: 120_000 });

http.interceptors.response.use(
	(response) => response,
	(error) => {
		const message =
			error?.response?.data?.error ||
			error?.message ||
			"请求失败";
		return Promise.reject(new Error(message));
	},
);

export type FieldType =
	| "string"
	| "text"
	| "date"
	| "datetime"
	| "number"
	| "boolean"
	| "tags"
	| "select"
	| "image"
	| "links";

export interface FieldDef {
	name: string;
	label: string;
	type: FieldType;
	required?: boolean;
	group?: "basic" | "display" | "advanced" | "security";
	hint?: string;
	placeholder?: string;
	options?: string[];
	default?: unknown;
	immutable?: boolean;
}

export interface ContentTypeMeta {
	key: string;
	label: string;
	kind: "md-bundle" | "md-file" | "ts-array";
	idLabel: string;
	titleField: string;
	dateField: string | null;
	hasBody: boolean;
	fields: FieldDef[];
	listFields: string[];
	hint?: string;
	configFile?: string;
	root: string;
}

export interface ContentSummary {
	type: string;
	id: string;
	path: string;
	fields: Record<string, unknown>;
}

export interface ContentDoc extends ContentSummary {
	body: string;
	raw?: string;
}

export interface SaveResult {
	ok: boolean;
	id: string;
	changed: boolean;
	warnings: string[];
	git?: { ok: boolean; message: string; skipped?: boolean };
}

export interface PhotoItem {
	name: string;
	url: string;
	size: number;
	mtime: number;
	isCover: boolean;
}

export interface UploadResult {
	relPath: string;
	reference: string;
	url: string;
	width: number;
	height: number;
	bytes: number;
	sha256: string;
	format: string;
	deduped: boolean;
}

export interface BuildRecord {
	status: "idle" | "running" | "success" | "failed";
	startedAt: number | null;
	finishedAt: number | null;
	durationMs: number | null;
	exitCode: number | null;
	error: string | null;
}

export interface SystemStatus {
	repoPath: string;
	port: number;
	devPort: number;
	uptimeMs: number;
	git: { changed: string[]; head: string | null };
	dev: { running: boolean; ready: boolean; url: string; pid: number | null };
	build: BuildRecord;
	webDistDir: string;
	hasWebBuild: boolean;
}

export const api = {
	async meta(): Promise<{ types: ContentTypeMeta[] }> {
		return (await http.get("/system/meta")).data;
	},
	async status(): Promise<SystemStatus> {
		return (await http.get("/system/status")).data;
	},
	async gitLog(limit = 20): Promise<{ entries: Array<{ hash: string; date: string; subject: string }> }> {
		return (await http.get("/system/git-log", { params: { limit } })).data;
	},
	async restartDev(): Promise<{ ok: boolean; url: string }> {
		return (await http.post("/system/restart-dev")).data;
	},
	async startDev(): Promise<{ ok: boolean; url: string; restarted: boolean }> {
		return (await http.post("/system/start-dev")).data;
	},
	async stopDev(): Promise<{ ok: boolean }> {
		return (await http.post("/system/stop-dev")).data;
	},
	async openDist(): Promise<{ ok: boolean; dir: string }> {
		return (await http.post("/system/open-dist")).data;
	},

	async list(type: string): Promise<{ items: ContentSummary[] }> {
		return (await http.get(`/content/${type}`)).data;
	},
	async get(type: string, id: string): Promise<{ doc: ContentDoc }> {
		return (await http.get(`/content/${type}/${encodeURIComponent(id)}`)).data;
	},
	async create(
		type: string,
		payload: { id?: string; fields: Record<string, unknown>; body?: string },
	): Promise<SaveResult> {
		return (await http.post(`/content/${type}`, payload)).data;
	},
	async update(
		type: string,
		id: string,
		payload: { fields: Record<string, unknown>; body?: string },
	): Promise<SaveResult> {
		return (await http.put(`/content/${type}/${encodeURIComponent(id)}`, payload)).data;
	},
	async remove(type: string, id: string): Promise<SaveResult> {
		return (await http.delete(`/content/${type}/${encodeURIComponent(id)}`)).data;
	},

	async photos(albumId: string): Promise<{ photos: PhotoItem[] }> {
		return (await http.get(`/albums/${albumId}/photos`)).data;
	},
	async uploadPhotos(albumId: string, files: File[]): Promise<{ uploaded: UploadResult[] }> {
		const form = new FormData();
		for (const file of files) form.append("files", file, file.name);
		return (await http.post(`/albums/${albumId}/photos`, form)).data;
	},
	async deletePhoto(albumId: string, name: string): Promise<SaveResult> {
		return (await http.delete(`/albums/${albumId}/photos/${encodeURIComponent(name)}`)).data;
	},
	async setCover(albumId: string, name: string): Promise<SaveResult> {
		return (await http.post(`/albums/${albumId}/cover`, { name })).data;
	},

	async upload(
		targetType: "post" | "moment" | "album" | "media",
		targetId: string | undefined,
		file: File,
	): Promise<UploadResult> {
		const form = new FormData();
		form.append("targetType", targetType);
		if (targetId) form.append("targetId", targetId);
		form.append("file", file, file.name);
		return (await http.post("/media/upload", form)).data;
	},
	async uploads(dir = "public/assets/images/uploads"): Promise<{
		dir: string;
		items: Array<{ name: string; url: string; size: number; mtime: number }>;
	}> {
		return (await http.get("/media/uploads", { params: { dir } })).data;
	},

	async buildStatus(): Promise<BuildRecord & { recentLines: Array<{ t: number; stream: string; text: string }> }> {
		return (await http.get("/build/status")).data;
	},
	async buildRun(): Promise<{ started: boolean; message?: string }> {
		return (await http.post("/build/run")).data;
	},
	async buildCancel(): Promise<{ cancelled: boolean }> {
		return (await http.post("/build/cancel")).data;
	},
	async buildLog(count = 400): Promise<{ lines: Array<{ t: number; stream: string; text: string }> }> {
		return (await http.get("/build/log", { params: { count } })).data;
	},
};

/**
 * 把博客站点路径转成后台可访问的预览地址。
 * 后台通过 /repo-assets/ 只读托管博客仓库的 public/，
 * 所以 /gallery/x/cover.webp → /repo-assets/gallery/x/cover.webp。
 * 相对路径（./xxx）无法在后台解析，返回空串由调用方降级展示。
 *
 * version 用于缓存击穿：换封面时文件名不变（仍是 cover.webp），
 * 只改内容的话浏览器会复用旧图，必须靠 query 变化强制重新拉取。
 */
export function toAssetUrl(value: unknown, version?: number | string): string {
	const text = typeof value === "string" ? value.trim() : "";
	if (!text) return "";
	let base: string;
	if (/^(https?:)?\/\//i.test(text) || /^(data|blob):/i.test(text)) base = text;
	else if (text.startsWith("/")) base = `/repo-assets${text}`;
	else return "";
	if (version === undefined || version === null || version === "") return base;
	const separator = base.includes("?") ? "&" : "?";
	return `${base}${separator}v=${encodeURIComponent(String(version))}`;
}
