import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export type LogStream = "stdout" | "stderr" | "system";
export interface LogLine {
	t: number;
	stream: LogStream;
	text: string;
}

export type BuildStatus = "idle" | "running" | "success" | "failed";

export interface BuildStep {
	label: string;
	command: string;
	args: string[];
}

export interface BuildRecord {
	status: BuildStatus;
	startedAt: number | null;
	finishedAt: number | null;
	durationMs: number | null;
	exitCode: number | null;
	error: string | null;
}

type Listener = (line: LogLine) => void;

const MAX_LINES = 3000;

export class LogBuffer {
	private lines: LogLine[] = [];
	private listeners = new Set<Listener>();

	push(stream: LogStream, text: string): void {
		for (const raw of text.split(/\r?\n/)) {
			if (raw.trim() === "" && stream !== "system") continue;
			const line: LogLine = { t: Date.now(), stream, text: raw };
			this.lines.push(line);
			if (this.lines.length > MAX_LINES) this.lines.shift();
			for (const listener of this.listeners) {
				try {
					listener(line);
				} catch {
					/* ignore */
				}
			}
		}
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	tail(count = 300): LogLine[] {
		return this.lines.slice(-count);
	}

	clear(): void {
		this.lines = [];
	}
}

export class ProcessManager {
	readonly buildLog = new LogBuffer();
	readonly devLog = new LogBuffer();

	private devProc: import("node:child_process").ChildProcess | null = null;
	private devReady = false;
	private devUrl = "";
	private devStarting: Promise<string> | null = null;

	private buildProc: import("node:child_process").ChildProcess | null = null;
	private record: BuildRecord = {
		status: "idle",
		startedAt: null,
		finishedAt: null,
		durationMs: null,
		exitCode: null,
		error: null,
	};
	private buildPromise: Promise<BuildRecord> | null = null;

	constructor(
		private readonly repoPath: string,
		private readonly devPort: number,
		private readonly buildSteps: BuildStep[],
	) {}

	// ─── dev server ──────────────────────────────────────────────

	get portalDevUrl(): string {
		return this.devUrl || `http://localhost:${this.devPort}`;
	}

	devStatus(): { running: boolean; ready: boolean; url: string; pid: number | null } {
		return {
			running: Boolean(this.devProc),
			ready: this.devReady,
			url: this.portalDevUrl,
			pid: this.devProc?.pid ?? null,
		};
	}

	async ensureDev(): Promise<{ url: string; restarted: boolean }> {
		if (this.devProc && this.devReady) {
			return { url: this.portalDevUrl, restarted: false };
		}
		if (this.devStarting) {
			const url = await this.devStarting;
			return { url, restarted: false };
		}
		this.devStarting = this.startDev();
		try {
			const url = await this.devStarting;
			return { url, restarted: true };
		} finally {
			this.devStarting = null;
		}
	}

	private astroEntry(): string {
		const candidates = [
			path.join(this.repoPath, "node_modules", "astro", "bin", "astro.mjs"),
			path.join(this.repoPath, "node_modules", "astro", "astro.js"),
		];
		for (const file of candidates) if (existsSync(file)) return file;
		throw new Error(
			`找不到 Astro 可执行文件，请先在博客仓库执行依赖安装：${this.repoPath}`,
		);
	}

	private startDev(): Promise<string> {
		const entry = this.astroEntry();
		this.devLog.clear();
		this.devReady = false;

		let proc: import("node:child_process").ChildProcess;
		try {
			proc = spawn(
				process.execPath,
				[entry, "dev", "--port", String(this.devPort)],
				{
					cwd: this.repoPath,
					windowsHide: true,
					env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
					stdio: ["ignore", "pipe", "pipe"],
				},
			);
		} catch (error) {
			return Promise.reject(new Error(`无法启动 astro dev：${(error as Error).message}`));
		}
		this.devProc = proc;

		return new Promise<string>((resolve, reject) => {
			let settled = false;
			const timer = setTimeout(() => {
				if (settled) return;
				settled = true;
				reject(
					new Error(
						`astro dev 启动超时（60s）。日志：\n${this.devLog
							.tail(30)
							.map((l) => l.text)
							.join("\n")}`,
					),
				);
			}, 60_000);

			const onChunk = (stream: LogStream) => (chunk: Buffer) => {
				const text = chunk.toString("utf-8");
				this.devLog.push(stream, text);
				const match = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)\/?/);
				if (match && !settled) {
					settled = true;
					clearTimeout(timer);
					this.devUrl = `http://localhost:${match[1]}`;
					this.devReady = true;
					resolve(this.devUrl);
				}
			};

			proc.stdout?.on("data", onChunk("stdout"));
			proc.stderr?.on("data", onChunk("stderr"));
			proc.on("error", (error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				reject(new Error(`astro dev 启动失败：${error.message}`));
			});
			proc.on("exit", (code) => {
				this.devLog.push("system", `astro dev 退出（code=${code}）`);
				this.devReady = false;
				this.devProc = null;
				if (!settled) {
					settled = true;
					clearTimeout(timer);
					reject(
						new Error(
							`astro dev 异常退出（code=${code}）。日志：\n${this.devLog
								.tail(30)
								.map((l) => l.text)
								.join("\n")}`,
						),
					);
				}
			});
		});
	}

	async restartDev(): Promise<{ url: string }> {
		await this.stopDev();
		const { url } = await this.ensureDev();
		return { url };
	}

	async stopDev(): Promise<void> {
		const proc = this.devProc;
		this.devProc = null;
		this.devReady = false;
		if (!proc || proc.pid == null) return;
		await killTree(proc.pid);
	}

	// ─── build ───────────────────────────────────────────────────

	buildSnapshot(): BuildRecord & { logTail: LogLine[] } {
		return { ...this.record, logTail: this.buildLog.tail(400) };
	}

	runBuild(): Promise<BuildRecord> {
		if (this.buildPromise) return this.buildPromise;
		this.buildPromise = this.executeBuild().finally(() => {
			this.buildPromise = null;
		});
		return this.buildPromise;
	}

	private async executeBuild(): Promise<BuildRecord> {
		const startedAt = Date.now();
		this.buildLog.clear();
		this.record = {
			status: "running",
			startedAt,
			finishedAt: null,
			durationMs: null,
			exitCode: null,
			error: null,
		};
		this.buildLog.push("system", `开始构建（${this.buildSteps.length} 步）`);

		try {
			if (existsSync(path.join(this.repoPath, "node_modules"))) {
				// 依赖已存在，直接构建
			} else {
				throw new Error(
					`博客仓库缺少 node_modules，请先执行依赖安装：${this.repoPath}`,
				);
			}

			for (const step of this.buildSteps) {
				this.buildLog.push("system", `▶ ${step.label}: ${step.command} ${step.args.join(" ")}`);
				const code = await this.runStep(step);
				if (code !== 0) {
					throw new Error(`步骤「${step.label}」失败（exit ${code}）`);
				}
				this.buildLog.push("system", `✔ ${step.label} 完成`);
			}

			const finishedAt = Date.now();
			this.record = {
				status: "success",
				startedAt,
				finishedAt,
				durationMs: finishedAt - startedAt,
				exitCode: 0,
				error: null,
			};
			this.buildLog.push(
				"system",
				`构建成功，用时 ${((finishedAt - startedAt) / 1000).toFixed(1)}s`,
			);
		} catch (error) {
			const finishedAt = Date.now();
			this.record = {
				status: "failed",
				startedAt,
				finishedAt,
				durationMs: finishedAt - startedAt,
				exitCode: this.record.exitCode,
				error: (error as Error).message,
			};
			this.buildLog.push("system", `构建失败：${(error as Error).message}`);
		}

		return this.record;
	}

	private runStep(step: BuildStep): Promise<number> {
		return new Promise((resolve) => {
			let proc: import("node:child_process").ChildProcess;
			try {
				proc = spawn(step.command, step.args, {
					cwd: this.repoPath,
					windowsHide: true,
					shell: process.platform === "win32" && /\.cmd$/i.test(step.command),
					env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", CI: "1" },
					stdio: ["ignore", "pipe", "pipe"],
				});
			} catch (error) {
				this.buildLog.push("system", `无法启动进程：${(error as Error).message}`);
				resolve(1);
				return;
			}
			this.buildProc = proc;

			proc.stdout?.on("data", (chunk: Buffer) =>
				this.buildLog.push("stdout", chunk.toString("utf-8")),
			);
			proc.stderr?.on("data", (chunk: Buffer) =>
				this.buildLog.push("stderr", chunk.toString("utf-8")),
			);
			proc.on("error", (error) => {
				this.buildLog.push("system", `无法启动进程：${error.message}`);
				this.buildProc = null;
				resolve(1);
			});
			proc.on("exit", (code) => {
				this.buildProc = null;
				this.record.exitCode = code;
				resolve(code ?? 1);
			});
		});
	}

	async cancelBuild(): Promise<boolean> {
		if (!this.buildProc || this.buildProc.pid == null) return false;
		this.buildLog.push("system", "用户取消构建");
		await killTree(this.buildProc.pid);
		return true;
	}

	async dispose(): Promise<void> {
		await this.stopDev();
		if (this.buildProc?.pid != null) await killTree(this.buildProc.pid);
	}
}

/** Windows 上必须连带子进程一起杀，否则 vite 会残留并占住端口 */
function killTree(pid: number): Promise<void> {
	return new Promise((resolve) => {
		try {
			if (process.platform === "win32") {
				spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
					windowsHide: true,
					stdio: "ignore",
				}).on("exit", () => resolve());
				return;
			}
			try {
				process.kill(-pid, "SIGTERM");
			} catch {
				try {
					process.kill(pid, "SIGTERM");
				} catch {
					/* ignore */
				}
			}
		} catch {
			/* ignore */
		}
		resolve();
	});
}
