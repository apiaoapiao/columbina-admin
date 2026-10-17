import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export interface GitResult {
	code: number;
	stdout: string;
	stderr: string;
}

export function isGitRepo(repoPath: string): boolean {
	return existsSync(path.join(repoPath, ".git"));
}

/** 用 execFile + 参数数组调用 git，避免 shell 注入 */
export function git(repoPath: string, args: string[], timeout = 15_000): Promise<GitResult> {
	return new Promise((resolve) => {
		try {
			execFile(
				"git",
				["-C", repoPath, ...args],
				{ timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
				(error, stdout, stderr) => {
					const code =
						error && typeof (error as { code?: number }).code === "number"
							? (error as { code: number }).code
							: error
								? 1
								: 0;
					resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
				},
			);
		} catch (error) {
			// git 未安装 / 无法创建子进程时优雅降级
			resolve({ code: 1, stdout: "", stderr: (error as Error).message });
		}
	});
}

export async function gitHead(repoPath: string): Promise<string | null> {
	if (!isGitRepo(repoPath)) return null;
	const result = await git(repoPath, ["rev-parse", "--short", "HEAD"]);
	return result.code === 0 ? result.stdout.trim() : null;
}

export async function gitStatus(repoPath: string): Promise<{ changed: string[]; head: string | null }> {
	if (!isGitRepo(repoPath)) return { changed: [], head: null };
	const [status, head] = await Promise.all([
		git(repoPath, ["status", "--porcelain"]),
		gitHead(repoPath),
	]);
	const changed =
		status.code === 0
			? status.stdout
					.split(/\r?\n/)
					.map((line) => line.trim())
					.filter(Boolean)
			: [];
	return { changed, head };
}

export interface CommitResult {
	ok: boolean;
	message: string;
	skipped?: boolean;
}

/**
 * 提交指定路径（相对仓库）。失败/非仓库/无变更时返回 ok:false 且不抛异常，
 * 由调用方决定是否提示用户（git 只是留痕，不阻断主流程）。
 */
export async function commitPaths(
	repoPath: string,
	paths: string[],
	message: string,
): Promise<CommitResult> {
	if (!isGitRepo(repoPath)) {
		return { ok: false, skipped: true, message: "不是 git 仓库，已跳过提交" };
	}
	const normalized = [...new Set(paths.map((p) => p.replace(/\\/g, "/")))].filter(Boolean);
	if (normalized.length === 0) {
		return { ok: false, skipped: true, message: "没有需要提交的路径" };
	}

	const add = await git(repoPath, ["add", "--", ...normalized]);
	if (add.code !== 0) {
		return { ok: false, message: `git add 失败：${add.stderr.trim()}` };
	}

	const staged = await git(repoPath, ["diff", "--cached", "--name-only"]);
	if (staged.code === 0 && staged.stdout.trim() === "") {
		return { ok: false, skipped: true, message: "内容无变化，跳过提交" };
	}

	const commit = await git(repoPath, ["commit", "-m", message, "--no-verify"]);
	if (commit.code !== 0) {
		return { ok: false, message: `git commit 失败：${(commit.stderr || commit.stdout).trim()}` };
	}
	return { ok: true, message: commit.stdout.trim().split(/\r?\n/)[0] ?? "已提交" };
}

export async function gitLog(
	repoPath: string,
	limit = 20,
): Promise<Array<{ hash: string; date: string; subject: string }>> {
	if (!isGitRepo(repoPath)) return [];
	const result = await git(repoPath, [
		"log",
		`-${limit}`,
		"--pretty=format:%h%x09%ad%x09%s",
		"--date=format:%Y-%m-%d %H:%M",
	]);
	if (result.code !== 0) return [];
	return result.stdout
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => {
			const [hash, date, subject] = line.split("\t");
			return { hash: hash ?? "", date: date ?? "", subject: subject ?? "" };
		});
}
