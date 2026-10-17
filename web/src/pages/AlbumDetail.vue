<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Delete, Edit, Star } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api, toAssetUrl, type ContentSummary, type PhotoItem } from "../api.ts";
import { store, formatBytes } from "../store.ts";

const route = useRoute();
const router = useRouter();

const albumId = computed(() => String(route.params.id));
const album = ref<ContentSummary | null>(null);
const photos = ref<PhotoItem[]>([]);
const loading = ref(false);
const uploading = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

async function load(): Promise<void> {
	loading.value = true;
	try {
		await store.ensureMeta();
		const { items } = await api.list("album");
		album.value = items.find((item) => String(item.fields.id) === albumId.value) ?? null;
		if (!album.value) {
			ElMessage.error(`相册 ${albumId.value} 不在 galleryConfig 中`);
			return;
		}
		const data = await api.photos(albumId.value);
		photos.value = data.photos;
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
		const result = await api.uploadPhotos(albumId.value, files);
		ElMessage.success(`已上传 ${result.uploaded.length} 张`);
		await load();
	} catch (error) {
		ElMessage.error((error as Error).message);
	} finally {
		uploading.value = false;
	}
}

async function makeCover(photo: PhotoItem): Promise<void> {
	try {
		await api.setCover(albumId.value, photo.name);
		ElMessage.success("已设为封面");
		await load();
	} catch (error) {
		ElMessage.error((error as Error).message);
	}
}

async function removePhoto(photo: PhotoItem): Promise<void> {
	try {
		await ElMessageBox.confirm(`删除照片 ${photo.name}？`, "删除确认", { type: "warning" });
	} catch {
		return;
	}
	try {
		await api.deletePhoto(albumId.value, photo.name);
		ElMessage.success("已删除");
		await load();
	} catch (error) {
		ElMessage.error((error as Error).message);
	}
}

function editMeta(): void {
	if (!album.value) return;
	const albumId = String(album.value.fields.id ?? album.value.id);
	router.push(`/c/album/${encodeURIComponent(albumId)}`);
}

// /albums/:id 同样会复用组件实例，切换相册时需要手动重载
watch(albumId, () => {
	album.value = null;
	photos.value = [];
	void load();
});

onMounted(load);
</script>

<template>
	<div class="ff-page" v-loading="loading">
		<div class="ff-page-head">
			<div>
				<h2 class="ff-page-title">
					{{ String(album?.fields.name ?? albumId) }}
					<span class="ff-mono" style="font-size: 13px; color: #909399">/gallery/{{ albumId }}/</span>
				</h2>
				<div class="ff-hint">{{ String(album?.fields.description ?? "") }}</div>
			</div>
			<div class="ff-toolbar">
				<el-button @click="router.push('/c/album')">返回列表</el-button>
				<el-button @click="editMeta">编辑相册信息</el-button>
				<el-button type="primary" :loading="uploading" @click="pickFiles">上传照片</el-button>
				<input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onFilesPicked" />
			</div>
		</div>

		<div class="ff-hint" style="margin-bottom: 12px">
			照片存放于 <code>public/gallery/{{ albumId }}/</code>，构建时自动扫描。封面优先使用 <code>cover.*</code> 文件。
		</div>

		<el-empty v-if="photos.length === 0" description="还没有照片，点右上角上传" />

		<div class="ff-photo-grid">
			<div v-for="photo in photos" :key="photo.name" class="ff-photo-card">
				<el-image :src="toAssetUrl(photo.url, photo.mtime)" fit="cover" lazy class="ff-photo-img">
					<template #error>
						<div class="ff-photo-error">
							加载失败（文件可能已被删除或重命名）<br />
							<span class="ff-mono">{{ photo.name }}</span>
						</div>
					</template>
				</el-image>
				<div class="ff-photo-meta">
					<span class="ff-mono" :title="photo.name">{{ photo.name }}</span>
					<span>{{ formatBytes(photo.size) }}</span>
				</div>
				<div class="ff-photo-actions">
					<el-tag v-if="photo.isCover" size="small" type="success" :icon="Star">封面</el-tag>
					<el-button v-else link type="primary" :icon="Star" @click="makeCover(photo)">
						设为封面
					</el-button>
					<el-button link type="danger" :icon="Delete" @click="removePhoto(photo)">删除</el-button>
				</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
.ff-photo-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
	gap: 14px;
}

.ff-photo-card {
	background: #fff;
	border: 1px solid var(--ff-border);
	border-radius: 10px;
	overflow: hidden;
	display: flex;
	flex-direction: column;
}

.ff-photo-card img {
	width: 100%;
	height: 150px;
	object-fit: cover;
	background: #f2f3f5;
	display: block;
}

.ff-photo-img {
	width: 100%;
	height: 150px;
	display: block;
	background: #f2f3f5;
}

.ff-photo-error {
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

.ff-photo-meta {
	display: flex;
	justify-content: space-between;
	gap: 6px;
	padding: 6px 10px 0;
	font-size: 11px;
	color: #909399;
	overflow: hidden;
}

.ff-photo-meta span:first-child {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.ff-photo-actions {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 4px 8px 8px;
	min-height: 26px;
}

.ff-photo-actions :deep(.el-button) {
	margin: 0;
	padding: 0;
	height: auto;
	line-height: 1.6;
}

.ff-photo-actions :deep(.el-tag) {
	margin: 0;
}
</style>
