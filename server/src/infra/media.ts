import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { AdminConfig } from "../config.ts";
import { ensureDir } from "./fsx.ts";
import { assertWritable, resolveInRepo } from "./paths.ts";

export type UploadTargetType = "post" | "moment" | "album" | "media";

export interface UploadTarget {
	type: UploadTargetType;
	/** post 用 slug，album 用 albumId */
	id?: string;
}

export interface UploadResult {
	relPath: string;
	/** 用于 Markdown 正文/封面的引用串 */
	reference: string;
	/** 浏览器可直接访问的 URL（仅 public 下的资源可用） */
	url: string;
	width: number;
	height: number;
	bytes: number;
	sha256: string;
	format: string;
	deduped: boolean;
}

const IMAGE_EXT = /\.(jpe?g|png|webp|avif|gif)$/i;

function asciiBase(name: string): string {
	const base = name
		.replace(/\.[^.]+$/, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return base || "img";
}

function targetDir(def: UploadTarget): string {
	switch (def.type) {
		case "post": {
			if (!def.id) throw new Error("文章配图需要提供文章 slug");
			return `src/content/posts/${def.id}/images`;
		}
		case "moment":
			return "public/assets/images/dynamic";
		case "album": {
			// 新建相册时可能还没填 albumId：落到独立封面目录，不报错
			return def.id ? `public/gallery/${def.id}` : "public/gallery/_covers";
		}
		default:
			return "public/assets/images/uploads";
	}
}

/** 生成引用串：文章用相对路径，其余用绝对 public 路径 */
function makeReference(def: UploadTarget, fileName: string): string {
	switch (def.type) {
		case "post":
			return `./images/${fileName}`;
		case "moment":
			return `/assets/images/dynamic/${fileName}`;
		case "album":
			return def.id ? `/gallery/${def.id}/${fileName}` : `/gallery/_covers/${fileName}`;
		default:
			return `/assets/images/uploads/${fileName}`;
	}
}

export class MediaService {
	constructor(private readonly config: AdminConfig) {}

	async processAndStore(
		def: UploadTarget,
		file: { buffer: Buffer; filename: string },
	): Promise<UploadResult> {
		if (!IMAGE_EXT.test(file.filename)) {
			throw new Error(`不支持的图片格式：${file.filename}（仅支持 jpg/png/webp/avif/gif）`);
		}
		if (file.buffer.byteLength > this.config.media.maxUploadBytes) {
			throw new Error(
				`文件超过上限 ${(this.config.media.maxUploadBytes / 1024 / 1024).toFixed(1)}MB`,
			);
		}

		const sha256 = createHash("sha256").update(file.buffer).digest("hex");
		const dirRel = targetDir(def);
		assertWritable(`${dirRel}/x.webp`);
		const dirAbs = resolveInRepo(this.config.repoPath, dirRel);

		// 去重：同目录下已有相同内容则直接复用
		const existing = await this.findByHash(dirAbs, sha256);
		if (existing) {
			const reference = makeReference(def, existing);
			const info = await sharp(path.join(dirAbs, existing)).metadata();
			return {
				relPath: `${dirRel}/${existing}`,
				reference,
				url: reference.startsWith("/") ? reference : "",
				width: info.width ?? 0,
				height: info.height ?? 0,
				bytes: 0,
				sha256,
				format: info.format ?? "webp",
				deduped: true,
			};
		}

		const base = asciiBase(file.filename);
		const shortHash = sha256.slice(0, 8);
		const isGif = /\.gif$/i.test(file.filename);

		let buffer: Buffer;
		let extName: string;
		let width = 0;
		let height = 0;
		let format = "webp";

		if (isGif && !this.config.media.convertToWebp) {
			buffer = file.buffer;
			extName = ".gif";
			format = "gif";
			const info = await sharp(file.buffer, { animated: true }).metadata();
			width = info.width ?? 0;
			height = info.height ?? 0;
		} else {
			// sharp 默认不保留 EXIF（含 GPS），rotate() 按 EXIF 方向自动摆正
			const pipeline = sharp(file.buffer, { animated: isGif })
				.rotate()
				.resize({
					width: this.config.media.maxEdge,
					height: this.config.media.maxEdge,
					fit: "inside",
					withoutEnlargement: true,
				});

			const encoded = this.config.media.convertToWebp
				? await pipeline
						.webp({ quality: this.config.media.webpQuality, effort: 4 })
						.toBuffer({ resolveWithObject: true })
				: await pipeline
						.jpeg({ quality: this.config.media.webpQuality, mozjpeg: true })
						.toBuffer({ resolveWithObject: true });

			buffer = encoded.data;
			width = encoded.info.width;
			height = encoded.info.height;
			extName = this.config.media.convertToWebp ? ".webp" : ".jpg";
			format = encoded.info.format;
		}

		const fileName = `${base}-${shortHash}${extName}`;
		const relPath = `${dirRel}/${fileName}`;
		assertWritable(relPath);
		const absPath = resolveInRepo(this.config.repoPath, relPath);
		await ensureDir(path.dirname(absPath));
		const tmpPath = `${absPath}.tmp-${shortHash}`;
		await writeFile(tmpPath, buffer);
		await rename(tmpPath, absPath);

		const reference = makeReference(def, fileName);
		return {
			relPath,
			reference,
			url: reference.startsWith("/") ? reference : "",
			width,
			height,
			bytes: buffer.byteLength,
			sha256,
			format,
			deduped: false,
		};
	}

	private async findByHash(dirAbs: string, sha256: string): Promise<string | null> {
		if (!existsSync(dirAbs)) return null;
		const short = sha256.slice(0, 8);
		const entries = await readdir(dirAbs, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isFile()) continue;
			if (!entry.name.includes(short)) continue;
			const abs = path.join(dirAbs, entry.name);
			const info = await stat(abs);
			if (info.size === 0) continue;
			const { readFile } = await import("node:fs/promises");
			const hash = createHash("sha256").update(await readFile(abs)).digest("hex");
			if (hash === sha256) return entry.name;
		}
		return null;
	}

	async listUploads(dirRel = "public/assets/images/uploads"): Promise<
		Array<{ name: string; url: string; size: number; mtime: number }>
	> {
		assertWritable(`${dirRel}/x.webp`);
		const dirAbs = resolveInRepo(this.config.repoPath, dirRel);
		if (!existsSync(dirAbs)) return [];
		const entries = await readdir(dirAbs, { withFileTypes: true });
		const result: Array<{ name: string; url: string; size: number; mtime: number }> = [];
		for (const entry of entries) {
			if (!entry.isFile() || !IMAGE_EXT.test(entry.name)) continue;
			const info = await stat(path.join(dirAbs, entry.name));
			const publicPath = dirRel.replace(/^public\//, "/");
			result.push({
				name: entry.name,
				url: `${publicPath}/${encodeURIComponent(entry.name)}`,
				size: info.size,
				mtime: info.mtimeMs,
			});
		}
		return result.sort((a, b) => b.mtime - a.mtime);
	}
}
