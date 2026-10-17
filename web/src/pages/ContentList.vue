<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { Delete, Edit } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api, type ContentSummary, type ContentTypeMeta } from "../api.ts";
import { store } from "../store.ts";
import { useRoute, useRouter } from "vue-router";

const route = useRoute();
const router = useRouter();

const type = computed(() => String(route.params.type));
const meta = computed<ContentTypeMeta | undefined>(() => store.typeMeta(type.value));
const items = ref<ContentSummary[]>([]);
const loading = ref(false);
const keyword = ref("");

async function load(): Promise<void> {
	loading.value = true;
	try {
		await store.ensureMeta();
		const data = await api.list(type.value);
		items.value = data.items;
	} catch (error) {
		ElMessage.error((error as Error).message);
	} finally {
		loading.value = false;
	}
}

const filtered = computed(() => {
	const kw = keyword.value.trim().toLowerCase();
	if (!kw) return items.value;
	return items.value.filter((item) => JSON.stringify(item.fields).toLowerCase().includes(kw));
});

const columns = computed(() => {
	const def = meta.value;
	if (!def) return [] as Array<{ name: string; label: string }>;
	return def.listFields.map((name) => {
		const field = def.fields.find((f) => f.name === name);
		return { name, label: field?.label ?? name };
	});
});

function rawId(item: ContentSummary): string {
	if (type.value === "album") return String(item.fields.id ?? item.id);
	return item.id;
}

function titleOf(item: ContentSummary): string {
	const def = meta.value;
	if (!def) return item.id;
	const value = item.fields[def.titleField];
	return String(value ?? item.id);
}

function display(item: ContentSummary, name: string): string {
	const value = item.fields[name];
	if (value === undefined || value === null) return "";
	if (typeof value === "boolean") return value ? "是" : "否";
	if (value instanceof Date) return value.toISOString().slice(0, 10);
	if (Array.isArray(value)) return value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ");
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

function tagType(item: ContentSummary): "success" | "info" {
	return item.fields.draft === true ? "info" : "success";
}

function createNew(): void {
	router.push(`/c/${type.value}/new`);
}

function openItem(item: ContentSummary): void {
	if (type.value === "album") {
		router.push(`/albums/${encodeURIComponent(rawId(item))}`);
		return;
	}
	router.push(`/c/${type.value}/${encodeURIComponent(item.id)}`);
}

async function removeItem(item: ContentSummary): Promise<void> {
	try {
		await ElMessageBox.confirm(
			`确定删除「${titleOf(item)}」吗？${type.value === "post" ? "（会连同目录与图片一起删除）" : ""}`,
			"删除确认",
			{ type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" },
		);
	} catch {
		return;
	}
	try {
		const result = await api.remove(type.value, rawId(item));
		ElMessage.success(result.git?.ok ? `已删除（${result.git.message}）` : "已删除");
		await load();
	} catch (error) {
		ElMessage.error((error as Error).message);
	}
}

// /c/post、/c/moment 等共用同一条路由记录，切换时组件会被复用而不会重新 mount，
// 因此必须监听 type 变化主动重新加载，否则会一直显示上一个模块的数据。
watch(type, () => {
	items.value = [];
	keyword.value = "";
	void load();
});

onMounted(load);
</script>

<template>
	<div class="ff-page">
		<div class="ff-page-head">
			<div>
				<h2 class="ff-page-title">{{ meta?.label ?? type }}</h2>
				<div class="ff-hint" v-if="meta?.hint">{{ meta.hint }}</div>
			</div>
			<div class="ff-toolbar">
				<el-input v-model="keyword" placeholder="搜索标题/内容" clearable style="width: 220px" />
				<el-button @click="load" :loading="loading">刷新</el-button>
				<el-button type="primary" @click="createNew">新建{{ meta?.label ?? "" }}</el-button>
			</div>
		</div>

		<el-table :data="filtered" v-loading="loading" border stripe style="width: 100%">
			<el-table-column label="ID" width="180" show-overflow-tooltip>
				<template #default="{ row }">
					<span class="ff-mono">{{ rawId(row) }}</span>
				</template>
			</el-table-column>
			<el-table-column
				v-for="column in columns"
				:key="column.name"
				:label="column.label"
				:min-width="column.name === 'title' || column.name === 'name' ? 220 : 120"
				show-overflow-tooltip
			>
				<template #default="{ row }">
					<el-tag v-if="column.name === 'draft'" size="small" :type="tagType(row)">
						{{ row.fields.draft ? "草稿" : "已发布" }}
					</el-tag>
					<span v-else>{{ display(row, column.name) }}</span>
				</template>
			</el-table-column>
			<el-table-column label="操作" width="150" align="center" fixed="right">
				<template #default="{ row }">
					<div class="ff-row-actions">
						<el-button link type="primary" :icon="Edit" @click="openItem(row)">编辑</el-button>
						<el-button link type="danger" :icon="Delete" @click="removeItem(row)">删除</el-button>
					</div>
				</template>
			</el-table-column>
			<template #empty>
				<div style="padding: 30px; color: #999">还没有内容，点右上角「新建」开始</div>
			</template>
		</el-table>
	</div>
</template>

<style scoped>
.ff-row-actions {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 14px;
	width: 100%;
}

/* 关键：Element Plus 会给相邻按钮加 margin-left，导致两个按钮看起来没对齐 */
.ff-row-actions :deep(.el-button) {
	margin: 0;
	padding: 0;
	height: auto;
	line-height: 1.6;
}
</style>
