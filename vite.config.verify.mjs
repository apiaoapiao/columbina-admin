/**
 * 受限环境下的前端构建验证配置（不依赖 esbuild 子进程）。
 *
 * 正常使用请用 vite.config.mjs（标准配置，esbuild + minify）。
 * 本配置仅用于在没有 esbuild 子进程能力的环境中验证"前端能否完整打包"：
 *   - esbuild: false，改用 TypeScript 编译器转译 .ts 与 <script lang="ts">
 *   - minify: false
 *
 * 用法：node node_modules/vite/bin/vite.js build --config vite.config.verify.mjs
 */
import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import ts from "typescript";
import { defineConfig } from "vite";

function stripTsTypes() {
	return {
		name: "strip-ts-without-esbuild",
		enforce: "pre",
		transform(code, id) {
			const isPlainTs = /\.tsx?(?:\?|$)/.test(id) && !id.includes(".vue");
			const isVueTs = id.includes(".vue") && /lang\.ts/.test(id);
			if (!isPlainTs && !isVueTs) return null;
			const result = ts.transpileModule(code, {
				fileName: id.split("?")[0],
				compilerOptions: {
					target: ts.ScriptTarget.ES2022,
					module: ts.ModuleKind.ESNext,
					moduleResolution: ts.ModuleResolutionKind.Bundler,
					isolatedModules: true,
					verbatimModuleSyntax: false,
					importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
					sourceMap: false,
					jsx: ts.JsxEmit.Preserve,
				},
			});
			return { code: result.outputText, map: null };
		},
	};
}

export default defineConfig({
	root: "web",
	esbuild: false,
	// 与 vite.config.mjs 保持一致：静态资源来自项目根 public/
	publicDir: fileURLToPath(new URL("./public", import.meta.url)),
	plugins: [stripTsTypes(), vue()],
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./web/src", import.meta.url)),
		},
		extensions: [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"],
	},
	build: {
		outDir: "dist",
		emptyOutDir: true,
		minify: false,
		cssMinify: false,
		target: "esnext",
		reportCompressedSize: false,
	},
});
