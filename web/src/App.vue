<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import {
	ChatDotRound,
	Document,
	Files,
	Folder,
	Link,
	Odometer,
	Picture,
	Setting,
} from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { api } from "./api.ts";
import { store } from "./store.ts";

const route = useRoute();
const logVisible = ref(false);
const buildLines = ref<Array<{ t: number; stream: string; text: string }>>([]);
const building = ref(false);
let timer: number | undefined;
let eventSource: EventSource | null = null;

const menu = [
	{ key: "dashboard", path: "/dashboard", label: "仪表盘", icon: Odometer },
	{ key: "post", path: "/c/post", label: "文章", icon: Document },
	{ key: "moment", path: "/c/moment", label: "动态", icon: ChatDotRound },
	{ key: "project", path: "/c/project", label: "项目", icon: Folder },
	{ key: "album", path: "/c/album", label: "相册", icon: Picture },
	{ key: "friend", path: "/c/friend", label: "友链", icon: Link },
	{ key: "media", path: "/media", label: "媒体库", icon: Files },
	{ key: "settings", path: "/settings", label: "设置", icon: Setting },
];

const activeKey = computed(() => {
	const path = route.path;
	if (path.startsWith("/albums/")) return "album";
	const match = path.match(/^\/c\/([^/]+)/);
	if (match) return match[1];
	if (path.startsWith("/media")) return "media";
	if (path.startsWith("/settings")) return "settings";
	return "dashboard";
});

const activePath = computed(
	() => menu.find((item) => item.key === activeKey.value)?.path ?? "/dashboard",
);

const gitLabel = computed(() => {
	const status = store.status;
	if (!status) return "连接中…";
	const head = status.git.head ? `@${status.git.head}` : "未初始化 git";
	const dirty = status.git.changed.length;
	return dirty > 0 ? `${head} · ${dirty} 个未提交变更` : head;
});

const buildLabel = computed(() => {
	const build = store.status?.build;
	if (!build) return "—";
	if (build.status === "running") return "构建中…";
	if (build.status === "success") return `上次构建成功 ${(build.durationMs ?? 0) / 1000}s`;
	if (build.status === "failed") return "上次构建失败";
	return "尚未构建";
});

const buildType = computed(() => {
	const status = store.status?.build?.status;
	if (status === "running") return "warning";
	if (status === "success") return "success";
	if (status === "failed") return "danger";
	return "info";
});

async function refreshBuildState(): Promise<void> {
	try {
		const record = await api.buildStatus();
		building.value = record.status === "running";
	} catch {
		/* ignore */
	}
}

async function startBuild(): Promise<void> {
	try {
		const result = await api.buildRun();
		if (!result.started) {
			ElMessage.warning(result.message ?? "构建已在进行中");
			return;
		}
		building.value = true;
		logVisible.value = true;
		connectLog();
	} catch (error) {
		ElMessage.error((error as Error).message);
	}
}

function connectLog(): void {
	eventSource?.close();
	buildLines.value = [];
	const source = new EventSource("/api/build/events");
	eventSource = source;
	source.onmessage = (event) => {
		try {
			const line = JSON.parse(event.data);
			buildLines.value.push(line);
			if (buildLines.value.length > 2000) buildLines.value.splice(0, 500);
		} catch {
			/* ignore */
		}
	};
	source.onerror = () => {
		/* 浏览器会自动重连 */
	};
}

onMounted(async () => {
	try {
		await store.ensureMeta();
	} catch (error) {
		ElMessage.error(`加载内容类型失败：${(error as Error).message}`);
	}
	await store.refreshStatus();
	await refreshBuildState();
	timer = window.setInterval(async () => {
		await store.refreshStatus();
		const previous = building.value;
		await refreshBuildState();
		if (previous && !building.value) {
			ElMessage.success("构建已结束，请查看日志确认结果");
		}
	}, 5000);
});

onUnmounted(() => {
	if (timer) window.clearInterval(timer);
	eventSource?.close();
});
</script>

<template>
	<el-container class="ff-shell">
		<el-aside width="200px" class="ff-aside">
			<div class="ff-brand">Columbina<br /><span>Admin</span></div>
			<el-menu :default-active="activePath" router class="ff-menu">
				<el-menu-item v-for="item in menu" :key="item.key" :index="item.path">
					<el-icon><component :is="item.icon" /></el-icon>
					<span>{{ item.label }}</span>
				</el-menu-item>
			</el-menu>
		</el-aside>

		<el-container>
			<el-header class="ff-header">
				<div class="ff-header-left">
					<el-tooltip :content="store.status?.repoPath ?? '—'" placement="bottom-start">
						<span class="ff-repo ff-mono">{{ store.status?.repoPath ?? "加载中…" }}</span>
					</el-tooltip>
					<el-tag size="small" type="info">{{ gitLabel }}</el-tag>
					<el-tag size="small" :type="buildType">{{ buildLabel }}</el-tag>
					<el-tag v-if="store.status?.dev.ready" size="small" type="success">
						预览已就绪
					</el-tag>
				</div>
				<div class="ff-toolbar">
					<el-button size="small" @click="logVisible = true">构建日志</el-button>
					<el-button type="primary" size="small" :loading="building" @click="startBuild">
						构建站点
					</el-button>
				</div>
			</el-header>

			<el-main class="ff-main">
				<router-view />
			</el-main>
		</el-container>

		<el-drawer v-model="logVisible" title="构建日志" size="60%" @open="connectLog">
			<div class="ff-log">
				<div v-for="(line, index) in buildLines" :key="index" :class="line.stream">
					{{ line.text }}
				</div>
			</div>
			<div class="ff-hint" style="margin-top: 8px">
				构建完成后，用你习惯的方式（FTP/主机面板）把仓库下的 <code>dist/</code> 上传到虚拟主机即可。
			</div>
		</el-drawer>
	</el-container>
</template>

<style scoped>
.ff-shell {
	height: 100%;
}

.ff-aside {
	background: #1f2330;
	color: #cfd3e0;
	display: flex;
	flex-direction: column;
}

.ff-brand {
	padding: 18px 20px 12px;
	font-size: 18px;
	font-weight: 700;
	line-height: 1.2;
	color: #fff;
	letter-spacing: 0.5px;
}

.ff-brand span {
	font-size: 12px;
	font-weight: 400;
	color: #8b93a7;
	letter-spacing: 2px;
}

.ff-menu {
	background: transparent;
	border-right: none;
	flex: 1;
}

.ff-menu :deep(.el-menu-item) {
	color: #cfd3e0;
}

.ff-menu :deep(.el-menu-item.is-active) {
	background: #2b3145;
	color: #fff;
}

.ff-menu :deep(.el-menu-item:hover) {
	background: #262b3b;
}

.ff-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	background: #fff;
	border-bottom: 1px solid var(--ff-border);
	padding: 0 18px;
	height: 56px;
}

.ff-header-left {
	display: flex;
	align-items: center;
	gap: 10px;
	min-width: 0;
	overflow: hidden;
}

.ff-repo {
	font-size: 12px;
	color: var(--ff-muted);
	max-width: 380px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.ff-main {
	padding: 0;
	overflow: auto;
}
</style>
