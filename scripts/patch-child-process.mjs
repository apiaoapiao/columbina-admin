/**
 * 受限环境专用 loader：
 * 1) 拦截 node:child_process 的 exec/execFile —— vite 在 Windows 上会 exec('net use') 探测网盘
 * 2) 把裸模块 esbuild 替换成纯 JS shim —— vite 的 define 替换走 esbuild.transform
 *
 * 仅在 scripts/verify-web-build.mjs 中通过 --import 加载，正常构建不需要。
 */
const CHILD_PROCESS_SOURCE = `
const real = process.getBuiltinModule('node:child_process');

function fakeExec() {
	return function (...args) {
		const callback = [...args].reverse().find((arg) => typeof arg === 'function');
		if (typeof callback === 'function') {
			queueMicrotask(() => callback(null, '', ''));
		}
		return {
			on() { return this; },
			once() { return this; },
			off() { return this; },
			removeListener() { return this; },
			kill() { return true; },
			unref() { return this; },
			stdout: null,
			stderr: null,
			pid: 0,
		};
	};
}

export const exec = fakeExec();
export const execFile = fakeExec();
export const spawn = real.spawn;
export const spawnSync = real.spawnSync;
export const execSync = real.execSync;
export const execFileSync = real.execFileSync;
export const fork = real.fork;
export default real;
`;

const ESBUILD_SHIM_SOURCE = `
function applyDefines(code, define) {
	// 必须按 key 长度降序替换：否则 "process.env" 会先把 "process.env.NODE_ENV" 拆坏
	const entries = Object.entries(define || {})
		.filter(([, value]) => typeof value === 'string')
		.sort((a, b) => b[0].length - a[0].length);
	let out = code;
	for (const [key, value] of entries) {
		if (!out.includes(key)) continue;
		out = out.split(key).join(value);
	}
	return out;
}

export async function transform(code, options = {}) {
	const out = applyDefines(String(code), options.define);
	return { code: out, map: '', warnings: [] };
}

export function transformSync(code, options = {}) {
	const out = applyDefines(String(code), options.define);
	return { code: out, map: '', warnings: [] };
}

export async function build() {
	throw new Error('esbuild shim: build() 不可用（受限环境仅用于验证前端打包）');
}

export const version = '0.0.0-shim';
export const formatMessages = () => [];
export default { transform, transformSync, build, version, formatMessages };
`;

export async function resolve(specifier, context, nextResolve) {
	if (specifier === "esbuild") {
		return { url: "esbuild-shim:esbuild", shortCircuit: true };
	}
	return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
	if (url === "node:child_process") {
		return { format: "module", shortCircuit: true, source: CHILD_PROCESS_SOURCE };
	}
	if (url === "esbuild-shim:esbuild") {
		return { format: "module", shortCircuit: true, source: ESBUILD_SHIM_SOURCE };
	}
	return nextLoad(url, context);
}
