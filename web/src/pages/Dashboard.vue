<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { api } from "../api.ts";
import { store } from "../store.ts";

const router = useRouter();
const counts = ref<Record<string, number>>({});
const log = ref<Array<{ hash: string; date: string; subject: string }>>([]);

const shortcuts = [
	{ type: "post", label: "文章", desc: "Markdown 长文，支持 Mermaid / Callout / 公式", icon: "📝" },
	{ type: "moment", label: "动态", desc: "一句话 + 图片，时间线展示", icon: "💬" },
	{ type: "project", label: "项目", desc: "项目卡片 + README", icon: "📁" },
	{ type: "album", label: "相册", desc: "目录式照片墙，构建时扫描", icon: "🖼️" },
	{ type: "friend", label: "友链", desc: "写入 friendsConfig.ts 的数组", icon: "🔗" },
];

async function load(): Promise<void> {
	try {
		await store.ensureMeta();
		await store.refreshStatus();
		const results = await Promise.all(
			shortcuts.map(async (item) => {
				try {
					const data = await api.list(item.type);
					return [item.type, data.items.length] as const;
				} catch {
					return [item.type, 0] as const;
				}
			}),
		);
		counts.value = Object.fromEntries(results);
		const { entries } = await api.gitLog(5);
		log.value = entries;
	} catch (error) {
		ElMessage.error((error as Error).message);
	}
}

onMounted(load);
</script>

<template>
	<div class="ff-page">
		<div class="ff-page-head">
			<div>
				<h2 class="ff-page-title">仪表盘</h2>
				<div class="ff-hint">
					直接读写本地 Firefly 仓库。改完点顶部「构建站点」，再把 <code>dist/</code> 上传到虚拟主机即可。
				</div>
			</div>
			<div class="ff-toolbar">
				<el-button @click="load">刷新</el-button>
			</div>
		</div>

		<div class="ff-stats">
			<el-card shadow="never" class="ff-stat">
				<div class="ff-stat-label">git HEAD</div>
				<div class="ff-stat-value ff-mono">{{ store.status?.git.head ?? "—" }}</div>
				<div class="ff-hint">{{ store.status?.git.changed.length ?? 0 }} 个未提交变更</div>
			</el-card>
			<el-card shadow="never" class="ff-stat">
				<div class="ff-stat-label">预览服务</div>
				<div class="ff-stat-value">
					{{ store.status?.dev.ready ? "运行中" : "未启动" }}
				</div>
				<div class="ff-hint">{{ store.status?.dev.url ?? "点编辑页「预览」自动启动" }}</div>
			</el-card>
			<el-card shadow="never" class="ff-stat">
				<div class="ff-stat-label">上次构建</div>
				<div class="ff-stat-value">
					{{
						store.status?.build.status === "success"
							? `${((store.status.build.durationMs ?? 0) / 1000).toFixed(0)}s 成功`
							: store.status?.build.status === "running"
								? "构建中"
								: store.status?.build.status === "failed"
									? "失败"
									: "未构建"
					}}
				</div>
				<div class="ff-hint">{{ store.status?.build.error ?? "构建后可手动上传 dist" }}</div>
			</el-card>
		</div>

		<div class="ff-shortcuts">
			<el-card
				v-for="item in shortcuts"
				:key="item.type"
				shadow="hover"
				class="ff-shortcut"
				@click="router.push(`/c/${item.type}`)"
			>
				<div class="ff-shortcut-icon">{{ item.icon }}</div>
				<div class="ff-shortcut-title">
					{{ item.label }}
					<el-tag size="small" type="info">{{ counts[item.type] ?? 0 }}</el-tag>
				</div>
				<div class="ff-hint">{{ item.desc }}</div>
			</el-card>
		</div>

		<el-card shadow="never">
			<template #header>最近提交</template>
			<el-table :data="log" size="small">
				<el-table-column prop="hash" label="commit" width="100" />
				<el-table-column prop="date" label="时间" width="150" />
				<el-table-column prop="subject" label="说明" />
			</el-table>
		</el-card>
	</div>
</template>

<style scoped>
.ff-stats {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
	gap: 14px;
	margin-bottom: 16px;
}

.ff-stat-label {
	font-size: 12px;
	color: #909399;
	margin-bottom: 6px;
}

.ff-stat-value {
	font-size: 20px;
	font-weight: 600;
	margin-bottom: 4px;
}

.ff-shortcuts {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
	gap: 14px;
	margin-bottom: 16px;
}

.ff-shortcut {
	cursor: pointer;
	transition: transform 0.15s ease;
}

.ff-shortcut:hover {
	transform: translateY(-2px);
}

.ff-shortcut-icon {
	font-size: 24px;
	margin-bottom: 6px;
}

.ff-shortcut-title {
	font-size: 15px;
	font-weight: 600;
	margin-bottom: 4px;
	display: flex;
	align-items: center;
	gap: 8px;
}
</style>
