import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const LF = "\n";

export function toLf(text: string): string {
	return text.replace(/\r\n/g, LF).replace(/\r/g, LF);
}

export async function ensureDir(dir: string): Promise<void> {
	await mkdir(dir, { recursive: true });
}

export async function exists(target: string): Promise<boolean> {
	try {
		await stat(target);
		return true;
	} catch {
		return false;
	}
}

export function existsSyncSafe(target: string): boolean {
	try {
		return existsSync(target);
	} catch {
		return false;
	}
}

/** 原子写：先写同目录临时文件，再 rename 覆盖 */
export async function atomicWrite(
	file: string,
	content: string,
): Promise<void> {
	await ensureDir(path.dirname(file));
	const tmp = `${file}.tmp-${randomUUID().slice(0, 8)}`;
	await writeFile(tmp, toLf(content), "utf-8");
	try {
		await rename(tmp, file);
	} catch (error) {
		await rm(tmp, { force: true });
		throw error;
	}
}

export function readTextSync(file: string): string {
	return readFileSync(file, "utf-8");
}

export async function readText(file: string): Promise<string> {
	return readFile(file, "utf-8");
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
	try {
		return JSON.parse(await readFile(file, "utf-8")) as T;
	} catch {
		return fallback;
	}
}

export async function writeJson(file: string, data: unknown): Promise<void> {
	await atomicWrite(file, `${JSON.stringify(data, null, 2)}\n`);
}

export function ensureDirSync(dir: string): void {
	mkdirSync(dir, { recursive: true });
}

/**
 * 轻量事务：写入前把受影响的原始状态落盘到 data/.txn/<id>/，
 * 成功即删，失败/崩溃后可恢复。
 */
export interface TxnFileSnapshot {
	/** 仓库相对路径 */
	rel: string;
	/** 原始内容（null 表示原本不存在） */
	content: string | null;
}

export class Transaction {
	readonly id: string;
	private readonly dir: string;
	private readonly snapshots: TxnFileSnapshot[] = [];
	private readonly createdDirs: string[] = [];

	constructor(
		private readonly dataDir: string,
		private readonly repoPath: string,
	) {
		this.id = `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
		this.dir = path.join(dataDir, ".txn", this.id);
		ensureDirSync(this.dir);
	}

	/** 记录恢复点（幂等：同一路径只记第一次） */
	snapshot(rel: string): void {
		if (this.snapshots.some((s) => s.rel === rel)) return;
		const abs = path.join(this.repoPath, rel);
		const content = existsSyncSafe(abs) ? readTextSync(abs) : null;
		this.snapshots.push({ rel, content });
		writeFileSync(
			path.join(this.dir, `${this.snapshots.length - 1}.json`),
			JSON.stringify({ rel, content }),
			"utf-8",
		);
	}

	trackDir(absDir: string): void {
		if (!this.createdDirs.includes(absDir)) this.createdDirs.push(absDir);
	}

	/** 回滚：恢复快照内容，删除本次新建的目录 */
	recover(): void {
		for (const snap of [...this.snapshots].reverse()) {
			const abs = path.join(this.repoPath, snap.rel);
			try {
				if (snap.content === null) {
					if (existsSyncSafe(abs)) rmSync(abs, { force: true });
				} else {
					ensureDirSync(path.dirname(abs));
					writeFileSync(abs, snap.content, "utf-8");
				}
			} catch (error) {
				console.error(`[txn] 回滚失败 ${snap.rel}:`, error);
			}
		}
		for (const dir of [...this.createdDirs].reverse()) {
			try {
				if (existsSyncSafe(dir) && readdirSync(dir).length === 0) {
					rmSync(dir, { recursive: true, force: true });
				}
			} catch {
				/* ignore */
			}
		}
		this.cleanup();
	}

	commit(): void {
		this.cleanup();
	}

	private cleanup(): void {
		try {
			rmSync(this.dir, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	}
}

export function dirSizeSync(dir: string): number {
	let total = 0;
	let entries: import("node:fs").Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return 0;
	}
	for (const entry of entries) {
		try {
			total += entry.isDirectory()
				? dirSizeSync(path.join(dir, entry.name))
				: statSync(path.join(dir, entry.name)).size;
		} catch {
			/* ignore */
		}
	}
	return total;
}
