import path from "node:path";

/**
 * 后台允许写入的路径白名单（相对博客仓库根，统一用 / 分隔）。
 * 任何写操作都必须先经过 assertWritable()。
 */
export const WRITABLE_PREFIXES = [
	"src/content/posts/",
	"src/content/dynamic/",
	"src/content/projects/",
	"src/content/spec/",
	"public/gallery/",
	"public/assets/images/",
] as const;

export const WRITABLE_FILES = [
	"src/config/galleryConfig.ts",
	"src/config/friendsConfig.ts",
] as const;

/** 只允许读取、用于展示/校验的路径 */
export const READABLE_FILES = [
	"src/content.config.ts",
	"src/config/siteConfig.ts",
	"src/config/galleryConfig.ts",
	"src/config/friendsConfig.ts",
	"package.json",
] as const;

export class PathAccessError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PathAccessError";
	}
}

/** 把任意输入规范化为仓库内相对路径（POSIX 风格），并拒绝越界 */
export function toRepoRelative(input: string): string {
	if (typeof input !== "string" || input.trim() === "") {
		throw new PathAccessError("路径不能为空");
	}
	let rel = input.replace(/\\/g, "/").trim();

	if (/^[a-zA-Z]:\//.test(rel) || rel.startsWith("//")) {
		throw new PathAccessError(`不接受绝对路径：${input}`);
	}
	rel = rel.replace(/^\.\//, "").replace(/^\/+/, "");

	const segments = rel.split("/");
	for (const seg of segments) {
		if (seg === "" || seg === ".") {
			throw new PathAccessError(`非法路径片段：${input}`);
		}
		if (seg === "..") {
			throw new PathAccessError(`路径不能包含 ".."：${input}`);
		}
		// Windows 保留名与可疑字符
		if (/[<>:"|?*\u0000-\u001f]/.test(seg)) {
			throw new PathAccessError(`路径包含非法字符：${input}`);
		}
		if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(seg)) {
			throw new PathAccessError(`路径包含 Windows 保留名：${input}`);
		}
	}
	return segments.join("/");
}

/** 解析为磁盘绝对路径，并确保仍位于 repo 内 */
export function resolveInRepo(repoPath: string, rel: string): string {
	const normalized = toRepoRelative(rel);
	const abs = path.resolve(repoPath, normalized);
	const rootWithSep = repoPath.endsWith(path.sep) ? repoPath : repoPath + path.sep;
	if (!abs.startsWith(rootWithSep)) {
		throw new PathAccessError(`路径越界：${rel}`);
	}
	return abs;
}

export function assertWritable(rel: string): string {
	const normalized = toRepoRelative(rel);
	const inPrefix = WRITABLE_PREFIXES.some((p) => normalized.startsWith(p));
	const inFiles = (WRITABLE_FILES as readonly string[]).includes(normalized);
	if (!inPrefix && !inFiles) {
		throw new PathAccessError(
			`该路径不在可写白名单内：${normalized}\n可写范围：\n${[
				...WRITABLE_PREFIXES,
				...WRITABLE_FILES,
			].join("\n")}`,
		);
	}
	return normalized;
}

/** slug / albumId 校验：小写字母数字与连字符 */
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function assertValidId(id: string, label = "id"): string {
	const value = String(id ?? "").trim();
	if (!ID_PATTERN.test(value)) {
		throw new PathAccessError(
			`${label} 只能由小写字母、数字、连字符组成，且以字母或数字开头：${JSON.stringify(id)}`,
		);
	}
	return value;
}

/** 中文标题 → 拼音 slug（不依赖第三方库的保守实现，无法转换时回退时间戳） */
export function slugify(input: string): string {
	const ascii = String(input ?? "")
		.trim()
		.toLowerCase()
		.replace(/['"`]/g, "")
		.replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (!ascii) return "";
	if (/^[a-z0-9-]+$/.test(ascii)) return ascii;
	// 含中文时，交给前端/调用方提供英文 slug；这里给出可用的占位
	return "";
}
