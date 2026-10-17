import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

export interface MediaConfig {
	maxUploadBytes: number;
	maxEdge: number;
	convertToWebp: boolean;
	webpQuality: number;
	stripExif: boolean;
}

export interface AdminConfig {
	/** Firefly 博客仓库的绝对路径 */
	repoPath: string;
	host: string;
	port: number;
	/** astro dev server 端口 */
	devPort: number;
	/** 每次写操作后是否自动 git commit */
	gitCommit: boolean;
	/** 改 src/config/*.ts 后是否自动重启 dev server */
	autoRestartDevOnConfigChange: boolean;
	media: MediaConfig;
}

const DEFAULT_CONFIG: Omit<AdminConfig, "repoPath"> = {
	host: "127.0.0.1",
	port: 4310,
	devPort: 4321,
	gitCommit: true,
	autoRestartDevOnConfigChange: true,
	media: {
		maxUploadBytes: 25 * 1024 * 1024,
		maxEdge: 2560,
		convertToWebp: true,
		webpQuality: 82,
		stripExif: true,
	},
};

function findConfigFile(): string | null {
	const candidates = [
		path.resolve(process.cwd(), "admin.config.json"),
		path.resolve(process.cwd(), "..", "admin.config.json"),
	];
	for (const file of candidates) {
		if (existsSync(file)) return file;
	}
	return null;
}

let cached: AdminConfig | null = null;

export async function loadConfig(force = false): Promise<AdminConfig> {
	if (cached && !force) return cached;

	const file = findConfigFile();
	let raw: Record<string, unknown> = {};
	if (file) {
		try {
			// 记事本/PowerShell 可能写入 BOM，这里统一剥掉
			const text = (await readFile(file, "utf-8")).replace(/^\uFEFF/, "");
			raw = JSON.parse(text);
		} catch (error) {
			throw new Error(`配置文件解析失败：${file}\n${(error as Error).message}`);
		}
	}

	const repoPathRaw =
		process.env.FIREFLY_REPO ||
		(typeof raw.repoPath === "string" ? raw.repoPath : undefined);

	if (!repoPathRaw) {
		throw new Error(
			[
				"未配置博客仓库路径。",
				"请复制 admin.config.example.json 为 admin.config.json，并把 repoPath 改成你的 Firefly 仓库绝对路径，",
				"例如：{ \"repoPath\": \"F:/Firefly-master/Firefly-master\" }",
			].join("\n"),
		);
	}

	const repoPath = path.resolve(repoPathRaw);
	if (!existsSync(repoPath)) {
		throw new Error(`repoPath 不存在：${repoPath}`);
	}
	if (!existsSync(path.join(repoPath, "astro.config.mjs"))) {
		throw new Error(
			`repoPath 看起来不是 Firefly 仓库（缺少 astro.config.mjs）：${repoPath}`,
		);
	}

	const media = {
		...DEFAULT_CONFIG.media,
		...(typeof raw.media === "object" && raw.media ? raw.media : {}),
	} as MediaConfig;

	cached = {
		...DEFAULT_CONFIG,
		...raw,
		repoPath,
		port: Number(process.env.PORT || raw.port || DEFAULT_CONFIG.port),
		media,
	} as AdminConfig;

	return cached;
}

export function getConfigSync(): AdminConfig {
	if (!cached) throw new Error("配置尚未加载");
	return cached;
}

export function adminDataDir(): string {
	return path.resolve(process.cwd(), "data");
}
