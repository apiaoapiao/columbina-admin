import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

// 从 admin.config.json 读取后端端口，避免 dev 代理写死
function backendPort() {
	try {
		const text = readFileSync(new URL("./admin.config.json", import.meta.url), "utf-8").replace(/^\uFEFF/, "");
		const config = JSON.parse(text);
		return Number(config.port) || 4310;
	} catch {
		return 4310;
	}
}

export default defineConfig({
	root: "web",
	// 静态资源放在项目根的 public/（与博客仓库习惯一致），
	// 例如 public/assets/images/moon5.png → 运行时 /assets/images/moon5.png
	publicDir: fileURLToPath(new URL("./public", import.meta.url)),
	plugins: [vue()],
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./web/src", import.meta.url)),
		},
	},
	server: {
		port: 5173,
		strictPort: true,
		proxy: {
			"/api": {
				target: `http://127.0.0.1:${backendPort()}`,
				changeOrigin: true,
			},
		},
	},
	build: {
		outDir: "dist",
		emptyOutDir: true,
	},
});
