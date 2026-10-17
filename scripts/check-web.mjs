// 校验所有 .vue 单文件组件能否被 Vue 官方编译器编译（不依赖 esbuild / vite）
// 用法：node scripts/check-web.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse, compileScript, compileTemplate } from "vue/compiler-sfc";
import ts from "typescript";

const ROOT = "web/src";
let checked = 0;
let failed = 0;

function walk(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			walk(full);
			continue;
		}
		if (entry.name.endsWith(".vue")) checkSfc(full);
		else if (entry.name.endsWith(".ts")) checkTs(full);
	}
}

function checkSfc(file) {
	const source = readFileSync(file, "utf8");
	const id = relative(ROOT, file).replace(/[^a-zA-Z0-9]/g, "_");
	const { descriptor, errors } = parse(source, { filename: file });
	if (errors.length > 0) {
		failed++;
		console.log(`FAIL  ${relative(ROOT, file)}`);
		for (const error of errors) console.log(`        ${error.message}`);
		return;
	}
	try {
		if (descriptor.script || descriptor.scriptSetup) {
			compileScript(descriptor, { id });
		}
		if (descriptor.template) {
			const result = compileTemplate({
				source: descriptor.template.content,
				filename: file,
				id,
			});
			if (result.errors.length > 0) {
				failed++;
				console.log(`FAIL  ${relative(ROOT, file)} (template)`);
				for (const error of result.errors) {
					console.log(`        ${typeof error === "string" ? error : error.message}`);
				}
				return;
			}
		}
		checked++;
		console.log(`  ok  ${relative(ROOT, file)}`);
	} catch (error) {
		failed++;
		console.log(`FAIL  ${relative(ROOT, file)}`);
		console.log(`        ${error.message}`);
	}
}

function checkTs(file) {
	const source = readFileSync(file, "utf8");
	const result = ts.transpileModule(source, {
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
		reportDiagnostics: true,
		fileName: file,
	});
	const diagnostics = (result.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
	if (diagnostics.length > 0) {
		failed++;
		console.log(`FAIL  ${relative(ROOT, file)}`);
		for (const d of diagnostics) console.log(`        ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
		return;
	}
	checked++;
	console.log(`  ok  ${relative(ROOT, file)}`);
}

walk(ROOT);
console.log(`\n检查完成：${checked} 个文件通过，${failed} 个失败`);
process.exit(failed > 0 ? 1 : 0);
