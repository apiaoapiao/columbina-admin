<script setup lang="ts">
import { ref } from "vue";
import { ElMessage } from "element-plus";
import { api } from "../api.ts";
import { store } from "../store.ts";

const refreshing = ref(false);

async function refresh(): Promise<void> {
	refreshing.value = true;
	try {
		await api.meta();
		store.metaLoaded = false;
		await store.ensureMeta();
		await store.refreshStatus();
	} catch (error) {
		ElMessage.error((error as Error).message);
	} finally {
		refreshing.value = false;
	}
}

async function restartDev(): Promise<void> {
	try {
		const { url } = await api.restartDev();
		ElMessage.success(`dev server 已重启：${url}`);
		await store.refreshStatus();
	} catch (error) {
		ElMessage.error((error as Error).message);
	}
}

async function openDist(): Promise<void> {
	try {
		const { dir } = await api.openDist();
		ElMessage.success(`已打开 ${dir}`);
	} catch (error) {
		ElMessage.error((error as Error).message);
	}
}

async function loadLog(): Promise<void> {
	try {
		const { entries } = await api.gitLog(20);
		log.value = entries;
	} catch (error) {
		ElMessage.error((error as Error).message);
	}
}

const log = ref<Array<{ hash: string; date: string; subject: string }>>([]);
void loadLog();
</script>

<template>
	<div class="ff-page">
		<div class="ff-page-head">
			<h2 class="ff-page-title">设置与状态</h2>
			<div class="ff-toolbar">
				<el-button :loading="refreshing" @click="refresh">刷新</el-button>
				<el-button @click="restartDev">重启 dev server</el-button>
				<el-button @click="openDist">打开 dist 目录</el-button>
			</div>
		</div>

		<el-card shadow="never" style="margin-bottom: 16px">
			<el-descriptions :column="2" border>
				<el-descriptions-item label="博客仓库">{{ store.status?.repoPath ?? "—" }}</el-descriptions-item>
				<el-descriptions-item label="git HEAD">
					<span class="ff-mono">{{ store.status?.git.head ?? "（非 git 仓库或未提交）" }}</span>
				</el-descriptions-item>
				<el-descriptions-item label="未提交变更">
					{{ store.status?.git.changed.length ?? 0 }} 个文件
				</el-descriptions-item>
				<el-descriptions-item label="dev server">
					<el-tag :type="store.status?.dev.ready ? 'success' : 'info'" size="small">
						{{ store.status?.dev.ready ? `运行中 ${store.status.dev.url}` : "未启动" }}
					</el-tag>
				</el-descriptions-item>
				<el-descriptions-item label="后端端口">{{ store.status?.port ?? "—" }}</el-descriptions-item>
				<el-descriptions-item label="预览端口">{{ store.status?.devPort ?? "—" }}</el-descriptions-item>
			</el-descriptions>
		</el-card>

		<el-card shadow="never" style="margin-bottom: 16px">
			<template #header>配置文件</template>
			<div class="ff-hint" style="line-height: 2">
				后台配置保存在项目根目录的 <code>admin.config.json</code>（不存在时参考
				<code>admin.config.example.json</code>）。修改后需要重启后台进程。
				<ul style="margin: 6px 0 0 16px; padding: 0">
					<li><code>repoPath</code>：Firefly 博客仓库绝对路径（必填）</li>
					<li><code>port</code> / <code>devPort</code>：后台端口与 astro dev 端口</li>
					<li><code>gitCommit</code>：每次写入后是否自动 git commit</li>
					<li><code>buildSteps</code>：自定义构建命令（默认只跑 <code>astro build</code>；如需完整 7 步可改成 <code>pnpm build</code>）</li>
				</ul>
			</div>
		</el-card>

		<el-card shadow="never">
			<template #header>最近提交</template>
			<el-table :data="log" size="small" border>
				<el-table-column prop="hash" label="commit" width="100" />
				<el-table-column prop="date" label="时间" width="150" />
				<el-table-column prop="subject" label="说明" />
			</el-table>
			<div class="ff-hint" style="margin-top: 8px">
				每次保存都会自动 commit（可通过 <code>gitCommit: false</code> 关闭），方便回滚。
			</div>
		</el-card>
	</div>
</template>
