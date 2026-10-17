import { existsSync } from "node:fs";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { AdminConfig } from "../config.ts";
import { atomicWrite, ensureDir, exists, toLf } from "../infra/fsx.ts";
import { commitPaths, type CommitResult } from "../infra/git.ts";
import { assertWritable, resolveInRepo } from "../infra/paths.ts";
import {
	buildDocument,
	formatDate,
	formatDateTime,
	parseDoc,
	verifyRoundTrip,
} from "./frontmatter.ts";
import type { ContentTypeDef, ContentTypeKey } from "./registry.ts";
import { getType } from "./registry.ts";
import { readTsArray, writeTsArray } from "./ts-array.ts";

const MD_EXT = /\.(md|mdx)$/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|avif|gif)$/i;

export interface ContentSummary {
	type: ContentTypeKey;
	id: string;
	path: string;
	fields: Record<string, unknown>;
}

export interface ContentDoc extends ContentSummary {
	body: string;
	raw?: string;
}

export interface SaveInput {
	fields: Record<string, unknown>;
	body?: string;
	/** 新建时指定的 id（相册/友链可省略） */
	id?: string;
}

export interface SaveResult {
	ok: boolean;
	id: string;
	changed: boolean;
	warnings: string[];
	git?: CommitResult;
}

export interface PhotoItem {
	name: string;
	url: string;
	size: number;
	/** 文件修改时间，用于前端做缓存击穿（换封面后 URL 不变但内容变了） */
	mtime: number;
	isCover: boolean;
}

function ext(name: string): string {
	const index = name.lastIndexOf(".");
	return index >= 0 ? name.slice(index).toLowerCase() : "";
}

function stripExt(name: string): string {
	return name.replace(MD_EXT, "");
}

function assertSafeId(id: string, label: string): string {
	const value = String(id ?? "").trim().replace(/\\/g, "/");
	if (!value) throw new Error(`${label} 不能为空`);
	for (const segment of value.split("/")) {
		if (!/^[a-z0-9][a-z0-9_-]*$/.test(segment)) {
			throw new Error(
				`${label} 每一段只能包含小写字母、数字、连字符、下划线，且以字母或数字开头：${JSON.stringify(id)}`,
			);
		}
	}
	return value;
}

export class ContentRepository {
	constructor(private readonly config: AdminConfig) {}

	private get repoPath(): string {
		return this.config.repoPath;
	}

	// ─── 读取 ────────────────────────────────────────────────────

	async list(type: ContentTypeKey): Promise<ContentSummary[]> {
		const def = getType(type);
		const summaries =
			def.kind === "ts-array" ? await this.listTsArray(def) : await this.listMarkdown(def);

		return summaries.sort((a, b) => compareItems(def, a.fields, b.fields));
	}

	private async listMarkdown(def: ContentTypeDef): Promise<ContentSummary[]> {
		const rootAbs = resolveInRepo(this.repoPath, def.root);
		if (!existsSync(rootAbs)) return [];

		const files: string[] = [];
		const walk = async (dir: string, prefix: string): Promise<void> => {
			let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
			try {
				entries = await readdir(dir, { withFileTypes: true });
			} catch {
				return;
			}
			for (const entry of entries) {
				if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
				const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
				if (entry.isDirectory()) {
					await walk(path.join(dir, entry.name), rel);
					continue;
				}
				if (!MD_EXT.test(entry.name)) continue;
				if (def.kind === "md-bundle" && entry.name.toLowerCase() !== "index.md" && entry.name.toLowerCase() !== "index.mdx") {
					// 兼容单文件文章：posts/foo.md
					files.push(rel);
					continue;
				}
				files.push(rel);
			}
		};
		await walk(rootAbs, "");

		const result: ContentSummary[] = [];
		for (const rel of files) {
			const id =
				def.kind === "md-bundle"
					? stripExt(rel).replace(/\/index$/, "").replace(/^index$/, "")
					: stripExt(rel);
			if (!id) continue;
			try {
				const raw = await readFile(path.join(rootAbs, rel), "utf-8");
				const parsed = parseDoc(raw);
				result.push({
					type: def.key,
					id,
					path: `${def.root}/${rel}`,
					fields: parsed.data,
				});
			} catch (error) {
				result.push({
					type: def.key,
					id,
					path: `${def.root}/${rel}`,
					fields: { title: `⚠️ 解析失败：${(error as Error).message}` },
				});
			}
		}
		return result;
	}

	private async listTsArray(def: ContentTypeDef): Promise<ContentSummary[]> {
		if (!def.configFile) return [];
		const abs = resolveInRepo(this.repoPath, def.configFile);
		if (!existsSync(abs)) return [];
		const { items } = await readTsArray(abs, def.configVar!, def.configProp);
		return items.map((item, index) => {
			const fields = (item ?? {}) as Record<string, unknown>;
			// 相册以 albumId 作为 id（与 read/update/delete 保持一致）；
			// 友链没有天然主键，用数组下标。
			const id = def.key === "album" ? String(fields.id ?? index) : String(index);
			return { type: def.key, id, path: def.configFile!, fields };
		});
	}

	async read(type: ContentTypeKey, id: string): Promise<ContentDoc> {
		const def = getType(type);

		if (def.kind === "ts-array") {
			const all = await this.listTsArray(def);
			const index = def.key === "album" ? all.findIndex((x) => String(x.fields.id) === id) : Number(id);
			const item = all[index];
			if (!item) throw new Error(`未找到${def.label}：${id}`);
			return { ...item, id: String(item.fields.id ?? index), body: "", raw: undefined };
		}

		const safeId = assertSafeId(id, def.idLabel);
		const file = await this.resolveMarkdownFile(def, safeId);
		if (!file) throw new Error(`未找到${def.label}：${id}`);
		const abs = resolveInRepo(this.repoPath, file);
		const raw = await readFile(abs, "utf-8");
		const parsed = parseDoc(raw);
		return {
			type: def.key,
			id: safeId,
			path: file,
			fields: parsed.data,
			body: parsed.content.replace(/^\n+/, ""),
			raw,
		};
	}

	private async resolveMarkdownFile(def: ContentTypeDef, id: string): Promise<string | null> {
		const candidates =
			def.kind === "md-bundle"
				? [`${def.root}/${id}/index.md`, `${def.root}/${id}/index.mdx`, `${def.root}/${id}.md`, `${def.root}/${id}.mdx`]
				: [`${def.root}/${id}.md`, `${def.root}/${id}.mdx`];
		for (const candidate of candidates) {
			if (existsSync(resolveInRepo(this.repoPath, candidate))) return candidate;
		}
		return null;
	}

	// ─── 写入 ────────────────────────────────────────────────────

	async create(type: ContentTypeKey, input: SaveInput): Promise<SaveResult> {
		const def = getType(type);
		// ts-array 类型（相册）的 id 同时也是字段，需要从顶层参数补齐。
		// 注意前端新建时会把 id 字段初始化为空字符串，所以不能只判断 undefined。
		let normalized = input;
		if (input.id) {
			const hasIdField = def.fields.some((field) => field.name === "id");
			const currentId = input.fields.id;
			const isEmpty =
				currentId === undefined || currentId === null || String(currentId).trim() === "";
			if (hasIdField && isEmpty) {
				normalized = { ...input, fields: { ...input.fields, id: input.id } };
			}
		}
		if (def.kind === "ts-array") return this.createTsArray(def, normalized);
		return this.createMarkdown(def, normalized);
	}

	async update(type: ContentTypeKey, id: string, input: SaveInput): Promise<SaveResult> {
		const def = getType(type);
		if (def.kind === "ts-array") return this.updateTsArray(def, id, input);
		return this.updateMarkdown(def, id, input);
	}

	async remove(type: ContentTypeKey, id: string): Promise<SaveResult> {
		const def = getType(type);
		if (def.kind === "ts-array") return this.removeTsArray(def, id);
		return this.removeMarkdown(def, id);
	}

	private async createMarkdown(def: ContentTypeDef, input: SaveInput): Promise<SaveResult> {
		const warnings: string[] = [];
		let id = String(input.id ?? "").trim();

		if (def.kind === "md-file" && def.key === "moment" && !id) {
			id = timestampId();
		}
		id = assertSafeId(id, def.idLabel);

		if (def.kind === "md-bundle") {
			const existsAlready =
				(await this.resolveMarkdownFile(def, id)) !== null ||
				existsSync(resolveInRepo(this.repoPath, `${def.root}/${id}`));
			if (existsAlready) throw new Error(`${def.label} ${id} 已存在`);
		} else {
			if ((await this.resolveMarkdownFile(def, id)) !== null) {
				throw new Error(`${def.label} ${id} 已存在`);
			}
		}

		const rel =
			def.kind === "md-bundle" ? `${def.root}/${id}/index.md` : `${def.root}/${id}.md`;
		assertWritable(rel);
		const abs = resolveInRepo(this.repoPath, rel);

		const values = this.prepareValues(def, input.fields, true);
		const errors = verifyRoundTrip(def.fields, values);
		if (errors.length > 0) throw new Error(`frontmatter 校验失败：\n${errors.join("\n")}`);

		const content = buildDocument(def.fields, values, input.body ?? "");
		await ensureDir(path.dirname(abs));
		await atomicWrite(abs, content);
		warnings.push(...(await this.collectImageWarnings(def, id, values, input.body ?? "")));

		const git = await this.maybeCommit([rel], `content(${def.key}): add ${id}`);
		return { ok: true, id, changed: true, warnings, git };
	}

	private async updateMarkdown(
		def: ContentTypeDef,
		id: string,
		input: SaveInput,
	): Promise<SaveResult> {
		const warnings: string[] = [];
		const safeId = assertSafeId(id, def.idLabel);
		const rel = await this.resolveMarkdownFile(def, safeId);
		if (!rel) throw new Error(`未找到${def.label}：${id}`);
		assertWritable(rel);
		const abs = resolveInRepo(this.repoPath, rel);

		const original = parseDoc(await readFile(abs, "utf-8"));
		const values = this.prepareValues(def, { ...original.data, ...input.fields }, false);
		const errors = verifyRoundTrip(def.fields, values);
		if (errors.length > 0) throw new Error(`frontmatter 校验失败：\n${errors.join("\n")}`);

		const body = input.body ?? original.content.replace(/^\n+/, "");
		const content = buildDocument(def.fields, values, body);
		const nextRaw = toLf(content);
		if (toLf(await readFile(abs, "utf-8")) === nextRaw) {
			return { ok: true, id: safeId, changed: false, warnings: ["内容无变化"] };
		}
		await atomicWrite(abs, content);
		warnings.push(...(await this.collectImageWarnings(def, safeId, values, body)));

		const git = await this.maybeCommit([rel], `content(${def.key}): update ${safeId}`);
		return { ok: true, id: safeId, changed: true, warnings, git };
	}

	private async removeMarkdown(def: ContentTypeDef, id: string): Promise<SaveResult> {
		const safeId = assertSafeId(id, def.idLabel);
		const rel = await this.resolveMarkdownFile(def, safeId);
		if (!rel) throw new Error(`未找到${def.label}：${id}`);
		assertWritable(rel);
		const abs = resolveInRepo(this.repoPath, rel);

		const targets = [rel];
		if (def.kind === "md-bundle" && path.basename(rel).toLowerCase().startsWith("index.")) {
			const dirRel = `${def.root}/${safeId}`;
			if (existsSync(resolveInRepo(this.repoPath, dirRel))) {
				await rm(resolveInRepo(this.repoPath, dirRel), { recursive: true, force: true });
				targets.push(dirRel);
			}
		} else {
			await rm(abs, { force: true });
		}

		const git = await this.maybeCommit(targets, `content(${def.key}): remove ${safeId}`);
		return { ok: true, id: safeId, changed: true, warnings: [], git };
	}

	// ─── ts-array（相册 / 友链）─────────────────────────────────

	private async configAbs(def: ContentTypeDef): Promise<string> {
		if (!def.configFile) throw new Error(`${def.label} 未配置配置文件`);
		assertWritable(def.configFile);
		return resolveInRepo(this.repoPath, def.configFile);
	}

	private async createTsArray(def: ContentTypeDef, input: SaveInput): Promise<SaveResult> {
		const warnings: string[] = [];
		const abs = await this.configAbs(def);
		const { items } = await readTsArray(abs, def.configVar!, def.configProp);
		const values = this.prepareValues(def, input.fields, true);
		if (def.key === "album") normalizeAlbumCover(values);

		if (def.key === "album") {
			const albumId = assertSafeId(String(values.id ?? ""), "albumId");
			if (items.some((item) => String((item as Record<string, unknown>).id) === albumId)) {
				throw new Error(`相册 ${albumId} 已存在`);
			}
			const dirRel = `${def.root}/${albumId}`;
			assertWritable(dirRel);
			const dirAbs = resolveInRepo(this.repoPath, dirRel);

			const next = [...items, values];
			await writeTsArray(abs, def.configVar!, def.configProp, next);
			try {
				await ensureDir(dirAbs);
			} catch (error) {
				// 目录创建失败 → 回滚配置
				await writeTsArray(abs, def.configVar!, def.configProp, items);
				throw new Error(`创建相册目录失败：${(error as Error).message}`);
			}
			const git = await this.maybeCommit([def.configFile!, dirRel], `content(album): add ${albumId}`);
			return { ok: true, id: albumId, changed: true, warnings, git };
		}

		const next = [...items, values];
		await writeTsArray(abs, def.configVar!, def.configProp, next);
		const index = next.length - 1;
		const git = await this.maybeCommit([def.configFile!], `content(friend): add ${String(values.title ?? index)}`);
		return { ok: true, id: String(index), changed: true, warnings, git };
	}

	private async updateTsArray(
		def: ContentTypeDef,
		id: string,
		input: SaveInput,
	): Promise<SaveResult> {
		const abs = await this.configAbs(def);
		const { items } = await readTsArray(abs, def.configVar!, def.configProp);

		const index =
			def.key === "album"
				? items.findIndex((item) => String((item as Record<string, unknown>).id) === id)
				: Number(id);
		if (index < 0 || index >= items.length) throw new Error(`未找到${def.label}：${id}`);

		const original = (items[index] ?? {}) as Record<string, unknown>;
		const merged = { ...original, ...input.fields };
		if (def.key === "album") {
			// albumId 不可变
			merged.id = original.id;
		}
		const values = this.prepareValues(def, merged, false);
		if (def.key === "album") normalizeAlbumCover(values);

		const next = items.map((item, i) => (i === index ? values : item));
		const result = await writeTsArray(abs, def.configVar!, def.configProp, next);
		if (!result.changed) return { ok: true, id, changed: false, warnings: ["内容无变化"] };

		const git = await this.maybeCommit([def.configFile!], `content(${def.key}): update ${id}`);
		return { ok: true, id, changed: true, warnings: [], git };
	}

	private async removeTsArray(def: ContentTypeDef, id: string): Promise<SaveResult> {
		const abs = await this.configAbs(def);
		const { items } = await readTsArray(abs, def.configVar!, def.configProp);

		const index =
			def.key === "album"
				? items.findIndex((item) => String((item as Record<string, unknown>).id) === id)
				: Number(id);
		if (index < 0 || index >= items.length) throw new Error(`未找到${def.label}：${id}`);

		const targets = [def.configFile!];
		const next = items.filter((_, i) => i !== index);
		await writeTsArray(abs, def.configVar!, def.configProp, next);

		if (def.key === "album") {
			const dirRel = `${def.root}/${id}`;
			assertWritable(dirRel);
			const dirAbs = resolveInRepo(this.repoPath, dirRel);
			if (existsSync(dirAbs)) {
				await rm(dirAbs, { recursive: true, force: true });
				targets.push(dirRel);
			}
		}

		const git = await this.maybeCommit(targets, `content(${def.key}): remove ${id}`);
		return { ok: true, id, changed: true, warnings: [], git };
	}

	// ─── 相册照片 ────────────────────────────────────────────────

	async listPhotos(albumId: string): Promise<PhotoItem[]> {
		const safeId = assertSafeId(albumId, "albumId");
		const dirRel = `public/gallery/${safeId}`;
		const dirAbs = resolveInRepo(this.repoPath, dirRel);
		if (!existsSync(dirAbs)) return [];

		const entries = await readdir(dirAbs, { withFileTypes: true });
		const photos: PhotoItem[] = [];
		for (const entry of entries) {
			if (!entry.isFile() || !IMAGE_EXT.test(entry.name)) continue;
			const info = await stat(path.join(dirAbs, entry.name));
			photos.push({
				name: entry.name,
				url: `/gallery/${safeId}/${encodeURIComponent(entry.name)}`,
				size: info.size,
				mtime: Math.round(info.mtimeMs),
				isCover: /^cover\./i.test(entry.name),
			});
		}
		return photos.sort((a, b) => {
			if (a.isCover !== b.isCover) return a.isCover ? -1 : 1;
			return a.name.localeCompare(b.name);
		});
	}

	async deletePhoto(albumId: string, name: string): Promise<SaveResult> {
		const safeId = assertSafeId(albumId, "albumId");
		if (!IMAGE_EXT.test(name) || name.includes("/") || name.includes("\\") || name.includes("..")) {
			throw new Error(`非法文件名：${name}`);
		}
		const rel = `public/gallery/${safeId}/${name}`;
		assertWritable(rel);
		const abs = resolveInRepo(this.repoPath, rel);
		if (!existsSync(abs)) throw new Error(`照片不存在：${name}`);
		await rm(abs, { force: true });
		const git = await this.maybeCommit([rel], `content(album): delete photo ${safeId}/${name}`);
		return { ok: true, id: name, changed: true, warnings: [], git };
	}

	async setCover(albumId: string, name: string): Promise<SaveResult> {
		const safeId = assertSafeId(albumId, "albumId");
		const dirAbs = resolveInRepo(this.repoPath, `public/gallery/${safeId}`);
		const sourceName = name;
		const warnings: string[] = [];
		if (!IMAGE_EXT.test(sourceName) || sourceName.includes("/") || sourceName.includes("\\")) {
			throw new Error(`非法文件名：${name}`);
		}
		if (/^cover\./i.test(sourceName)) {
			return { ok: true, id: sourceName, changed: false, warnings: ["已经是封面"] };
		}

		const entries = await readdir(dirAbs, { withFileTypes: true });
		const oldCovers = entries
			.filter((e) => e.isFile() && /^cover\./i.test(e.name) && e.name !== sourceName)
			.map((e) => e.name);

		const targets: string[] = [];

		// 旧封面不删除：改名归档成相册里的普通照片（cover-<时间戳>.<ext>），
		// 这样照片不会因为换封面而凭空消失，需要的话可以手动删。
		const stamp = fileStamp();
		for (const old of oldCovers) {
			const suffix = ext(old);
			let archiveName = `cover-${stamp}${suffix}`;
			let counter = 1;
			while (existsSync(path.join(dirAbs, archiveName))) {
				archiveName = `cover-${stamp}-${counter}${suffix}`;
				counter++;
			}
			await renameWithFallback(path.join(dirAbs, old), path.join(dirAbs, archiveName));
			targets.push(`public/gallery/${safeId}/${archiveName}`);
			warnings.push(`旧封面已保留为 ${archiveName}`);
		}

		const targetName = `cover${ext(sourceName)}`;
		await renameWithFallback(path.join(dirAbs, sourceName), path.join(dirAbs, targetName));
		targets.push(`public/gallery/${safeId}/${targetName}`);

		// 关键：Firefly 取封面的优先级是 album.cover > cover.* 文件 > 第一张图。
		// 只重命名文件而不改配置，配置里的旧路径依然优先，页面会显示已经不存在的旧图。
		const coverRel = `/gallery/${safeId}/${targetName}`;
		const albumDef = getType("album");
		if (albumDef.configFile) {
			const configAbs = resolveInRepo(this.repoPath, albumDef.configFile);
			const { items } = await readTsArray(configAbs, albumDef.configVar!, albumDef.configProp);
			const index = items.findIndex(
				(item) => String((item as Record<string, unknown> | null)?.id ?? "") === safeId,
			);
			if (index >= 0) {
				const current = (items[index] ?? {}) as Record<string, unknown>;
				if (String(current.cover ?? "") !== coverRel) {
					const next = items.map((item, i) =>
						i === index ? { ...(item as Record<string, unknown>), cover: coverRel } : item,
					);
					await writeTsArray(configAbs, albumDef.configVar!, albumDef.configProp, next);
					targets.push(albumDef.configFile);
				}
			}
		}

		const git = await this.maybeCommit(targets, `content(album): set cover ${safeId}/${targetName}`);
		return { ok: true, id: targetName, changed: true, warnings, git };
	}

	// ─── 内部工具 ────────────────────────────────────────────────

	private prepareValues(
		def: ContentTypeDef,
		raw: Record<string, unknown>,
		isNew: boolean,
	): Record<string, unknown> {
		const values: Record<string, unknown> = {};
		for (const field of def.fields) {
			let value = raw[field.name];
			switch (field.type) {
				case "tags": {
					value = normalizeTags(value);
					break;
				}
				case "date": {
					value = value === undefined || value === "" ? undefined : formatDate(value);
					break;
				}
				case "datetime": {
					value = value === undefined || value === "" ? undefined : formatDateTime(value);
					break;
				}
				case "number": {
					if (value === undefined || value === "" || value === null) value = undefined;
					else value = Number(value);
					break;
				}
				case "boolean": {
					value = value === undefined ? (isNew ? field.default : false) : Boolean(value);
					break;
				}
				case "links": {
					value = Array.isArray(value)
						? (value as Array<Record<string, unknown>>)
								.filter((item) => item && String(item.value ?? "").trim() !== "")
								.map((item) => ({
									label: String(item.label ?? ""),
									icon: String(item.icon ?? ""),
									value: String(item.value ?? ""),
								}))
						: [];
					break;
				}
				default: {
					value = value === undefined || value === null ? "" : String(value);
				}
			}

			if (field.required && (value === undefined || value === "" || (Array.isArray(value) && value.length === 0))) {
				throw new Error(`字段「${field.label}」是必填项`);
			}
			if (value !== undefined) values[field.name] = value;
		}
		return values;
	}

	private async collectImageWarnings(
		def: ContentTypeDef,
		id: string,
		values: Record<string, unknown>,
		body: string,
	): Promise<string[]> {
		const warnings: string[] = [];
		const dirRel = def.kind === "md-bundle" ? `${def.root}/${id}` : def.root;

		const references: string[] = [];
		const cover = values.image ?? values.cover;
		if (typeof cover === "string" && cover.trim() && cover.trim() !== "api") {
			references.push(cover.trim());
		}
		references.push(...extractImageRefs(body));

		for (const ref of references) {
			const resolved = resolveImageRef(this.repoPath, dirRel, ref);
			if (resolved === "external" || resolved === "skip") continue;
			if (!existsSync(resolved)) {
				warnings.push(`图片引用不存在：${ref}`);
			}
		}
		return warnings;
	}

	private async maybeCommit(paths: string[], message: string): Promise<CommitResult | undefined> {
		if (!this.config.gitCommit) return undefined;
		try {
			return await commitPaths(this.repoPath, paths, message);
		} catch (error) {
			return { ok: false, message: `git 提交异常：${(error as Error).message}` };
		}
	}
}

// ─── 工具函数 ─────────────────────────────────────────────────

function timestampId(): string {
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** 用于归档旧封面的紧凑时间戳：YYYYMMDD-HHmmss */
function fileStamp(): string {
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/**
 * 相册封面路径规范化。
 * Firefly 的 getAlbumCover() 会把非绝对路径补成站根路径（cover.jpg → /cover.jpg），
 * 所以用户填 `cover.jpg` 或 `./cover.jpg` 会 404。这里统一补成 /gallery/<albumId>/...
 */
function normalizeAlbumCover(values: Record<string, unknown>): void {
	const raw = values.cover;
	if (typeof raw !== "string") return;
	const text = raw.trim();
	if (text === "") return;
	if (/^(https?:)?\/\//i.test(text) || /^(data|blob):/i.test(text)) return;
	if (text.startsWith("/")) return;
	const albumId = String(values.id ?? "");
	if (!albumId) return;
	values.cover = `/gallery/${albumId}/${text.replace(/^\.\//, "")}`;
}

function normalizeTags(value: unknown): string[] {	if (Array.isArray(value)) {
		return value.map((v) => String(v).trim()).filter(Boolean);
	}
	if (typeof value === "string") {
		return value
			.split(/[,，]/)
			.map((v) => v.trim())
			.filter(Boolean);
	}
	return [];
}

function extractImageRefs(body: string): string[] {
	const withoutCode = body
		.replace(/```[\s\S]*?```/g, "")
		.replace(/~~~[\s\S]*?~~~/g, "")
		.replace(/`[^`\n]*`/g, "");
	const refs: string[] = [];
	const pattern = /!\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
	for (const match of withoutCode.matchAll(pattern)) {
		if (match[1]) refs.push(match[1]);
	}
	return refs;
}

function resolveImageRef(
	repoPath: string,
	baseDirRel: string,
	ref: string,
): string | "external" | "skip" {
	if (/^(https?:)?\/\//i.test(ref) || /^(data|blob):/i.test(ref)) return "external";
	if (/^\{/.test(ref)) return "skip";
	if (ref.startsWith("/")) {
		return path.resolve(repoPath, "public", ref.replace(/^\/+/, ""));
	}
	return path.resolve(repoPath, baseDirRel, ref.replace(/^\.\//, ""));
}

function compareItems(
	def: ContentTypeDef,
	a: Record<string, unknown>,
	b: Record<string, unknown>,
): number {
	const field = def.dateField;
	const valueOf = (row: Record<string, unknown>, key: string | null): string => {
		if (!key) return "";
		const raw = row[key];
		if (raw instanceof Date) return raw.toISOString();
		if (typeof raw === "number") return String(raw).padStart(12, "0");
		return String(raw ?? "");
	};

	if (def.defaultSort === "weight-desc") {
		const diff = Number(b.weight ?? 0) - Number(a.weight ?? 0);
		if (diff !== 0) return diff;
	}
	if (def.defaultSort === "order-asc") {
		const aOrder = a.order === undefined || a.order === null ? Number.MAX_SAFE_INTEGER : Number(a.order);
		const bOrder = b.order === undefined || b.order === null ? Number.MAX_SAFE_INTEGER : Number(b.order);
		if (aOrder !== bOrder) return aOrder - bOrder;
	}
	const av = valueOf(a, field);
	const bv = valueOf(b, field);
	return bv.localeCompare(av);
}

async function renameWithFallback(from: string, to: string): Promise<void> {
	const { rename } = await import("node:fs/promises");
	try {
		await rename(from, to);
	} catch {
		await rm(to, { force: true });
		await rename(from, to);
	}
}
