<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { api, toAssetUrl } from "../api.ts";
import { formatBytes } from "../store.ts";

interface UploadItem {
	name: string;
	url: string;
	size: number;
	mtime: number;
}

const items = ref<UploadItem[]>([]);
const loading = ref(false);
const uploading = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

async function load(): Promise<void> {
	loading.value = true;
	try {
		const data = await api.uploads();
		items.value = data.items;
	} catch (error) {
		ElMessage.error((error as Error).message);
	} finally {
		loading.value = false;
	}
}

function pickFiles(): void {
	fileInput.value?.click();
}

async function onFilesPicked(event: Event): Promise<void> {
	const input = event.target as HTMLInputElement;
	const files = Array.from(input.files ?? []);
	input.value = "";
	if (files.length === 0) return;
	uploading.value = true;
	try {
		for (const file of files) {
			await api.upload("media", undefined, file);
		}
		ElMessage.success(`已上传 ${files.length} 张`);
		await load();
	} catch (error) {
		ElMessage.error((error as Error).message);
	} finally {
		uploading.value = false;
	}
}

async function copyPath(url: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(url);
		ElMessage.success(`已复制：${url}`);
	} catch {
		ElMessage.warning(`请手动复制：${url}`);
	}
}

onMounted(load);
</script>

<template>
	<div class="ff-page">
		<div class="ff-page-head">
			<div>
				<h2 class="ff-page-title">媒体库</h2>
				<div class="ff-hint">
					通用图片上传到 <code>public/assets/images/uploads/</code>，可复制路径用于封面或友链头像。
				</div>
			</div>
			<div class="ff-toolbar">
				<el-button @click="load" :loading="loading">刷新</el-button>
				<el-button type="primary" :loading="uploading" @click="pickFiles">上传图片</el-button>
				<input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onFilesPicked" />
			</div>
		</div>

		<el-empty v-if="items.length === 0 && !loading" description="还没有上传过图片" />

		<div class="ff-media-grid">
			<div v-for="item in items" :key="item.name" class="ff-media-card">
				<el-image :src="toAssetUrl(item.url, item.mtime)" fit="cover" lazy class="ff-media-img">
					<template #error>
						<div class="ff-media-error">
							加载失败<br />
							<span class="ff-mono">{{ item.name }}</span>
						</div>
					</template>
				</el-image>
				<div class="ff-media-meta">
					<span class="ff-mono" :title="item.name">{{ item.name }}</span>
					<span>{{ formatBytes(item.size) }}</span>
				</div>
				<el-button size="small" text type="primary" @click="copyPath(item.url)">复制路径</el-button>
			</div>
		</div>
	</div>
</template>

<style scoped>
.ff-media-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
	gap: 14px;
}

.ff-media-card {
	background: #fff;
	border: 1px solid var(--ff-border);
	border-radius: 10px;
	overflow: hidden;
	display: flex;
	flex-direction: column;
}

.ff-media-card img {
	width: 100%;
	height: 130px;
	object-fit: cover;
	background: #f2f3f5;
	display: block;
}

.ff-media-img {
	width: 100%;
	height: 130px;
	display: block;
	background: #f2f3f5;
}

.ff-media-error {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 4px;
	width: 100%;
	height: 100%;
	padding: 8px;
	font-size: 11px;
	line-height: 1.5;
	text-align: center;
	color: #c45656;
	background: #fef0f0;
	word-break: break-all;
}

.ff-media-meta {
	display: flex;
	justify-content: space-between;
	gap: 6px;
	padding: 6px 10px;
	font-size: 11px;
	color: #909399;
	overflow: hidden;
}

.ff-media-meta span:first-child {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
</style>
