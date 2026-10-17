<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { api, type ContentTypeMeta, type FieldDef } from "../api.ts";
import { store } from "../store.ts";
import FieldInput from "../components/FieldInput.vue";
import MarkdownEditor from "../components/MarkdownEditor.vue";

const route = useRoute();
const router = useRouter();

const type = computed(() => String(route.params.type));
const idParam = computed(() => (route.params.id ? String(route.params.id) : ""));
const isNew = computed(() => route.name === "new");

const meta = ref<ContentTypeMeta>();
const fields = ref<Record<string, unknown>>({});
const body = ref("");
const newId = ref("");
const loading = ref(false);
const saving = ref(false);
const activeGroups = ref<string[]>(["basic", "display"]);
const previewVisible = ref(false);
const previewUrl = ref("");
const editorRef = ref<InstanceType<typeof MarkdownEditor> | null>(null);

const pad = (n: number) => String(n).padStart(2, "0");

function todayString(): string {
	const now = new Date();
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function nowString(): string {
	const now = new Date();
	return `${todayString()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

const idField = computed<FieldDef | undefined>(() =>
	meta.value?.fields.find((field) => field.name === "id"),
);

const groups = computed(() => {
	const def = meta.value;
	if (!def) return [] as Array<{ key: string; label: string; fields: FieldDef[] }>;
	const bucket: Record<string, FieldDef[]> = { basic: [], display: [], advanced: [], security: [] };
	for (const field of def.fields) {
		// 新建时 id 由顶部输入框统一负责，避免和表单里的 id 字段重复
		if (isNew.value && field.immutable && field.name === "id") continue;
		bucket[field.group ?? "basic"].push(field);
	}
	const labels: Record<string, string> = {
		basic: "基础信息",
		display: "展示设置",
		advanced: "高级选项",
		security: "安全（密码）",
	};
	return (["basic", "display", "advanced", "security"] as const)
		.map((key) => ({ key, label: labels[key], fields: bucket[key] }))
		.filter((group) => group.fields.length > 0);
});

function defaults(def: ContentTypeMeta): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const field of def.fields) {
		if (field.default !== undefined) out[field.name] = field.default;
		else if (field.type === "tags" || field.type === "links") out[field.name] = [];
		else if (field.type === "boolean") out[field.name] = false;
		else out[field.name] = "";
	}
	if (def.key === "moment") out.published = nowString();
	if (def.key === "post" || def.key === "project") out.published = todayString();
	return out;
}

function normalizeValue(field: FieldDef, value: unknown): unknown {
	if (value instanceof Date) {
		const date = `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
		if (field.type === "date") return date;
		return `${date} ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`;
	}
	if (value === undefined || value === null) {
		if (field.type === "boolean") return false;
		if (field.type === "tags" || field.type === "links") return [];
		return "";
	}
	return value;
}

function normalizeValues(def: ContentTypeMeta, raw: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const field of def.fields) out[field.name] = normalizeValue(field, raw[field.name]);
	return out;
}

const albumPhotos = ref<Array<{ label: string; value: string }>>([]);

/** 相册封面可以从相册内已上传的照片里直接选 */
async function loadAlbumPhotos(albumId: string): Promise<void> {
	if (!albumId) {
		albumPhotos.value = [];
		return;
	}
	try {
		const data = await api.photos(albumId);
		albumPhotos.value = data.photos.map((photo) => ({ label: photo.name, value: photo.url }));
	} catch {
		albumPhotos.value = [];
	}
}

async function load(): Promise<void> {
	loading.value = true;
	try {
		await store.ensureMeta();
		meta.value = store.typeMeta(type.value);
		if (!meta.value) throw new Error(`未知内容类型：${type.value}`);

		if (isNew.value) {
			fields.value = defaults(meta.value);
			body.value = "";
			newId.value = "";
			albumPhotos.value = [];
		} else {
			const data = await api.get(type.value, idParam.value);
			fields.value = normalizeValues(meta.value, data.doc.fields);
			body.value = data.doc.body ?? "";
			newId.value = data.doc.id;
			if (type.value === "album") {
				await loadAlbumPhotos(String(fields.value.id ?? data.doc.id));
			}
		}
	} catch (error) {
		ElMessage.error((error as Error).message);
	} finally {
		loading.value = false;
	}
}

const needsIdInput = computed(() => isNew.value && meta.value && meta.value.key !== "friend");
const idOptional = computed(() => meta.value?.key === "moment");

function guessSlug(): void {
	const title = String(fields.value.title ?? "").trim().toLowerCase();
	const ascii = title
		.replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (!ascii) {
		ElMessage.warning("标题里没有可用的英文/数字，请手动填写 slug");
		return;
	}
	if (/[\u4e00-\u9fa5]/.test(ascii)) {
		ElMessage.warning("标题含中文，请手动填写英文 slug（建议用拼音或英文短语）");
		return;
	}
	newId.value = ascii;
}

function targetTypeForUpload(): "post" | "moment" | "album" | "media" {
	const key = type.value;
	if (key === "post") return "post";
	if (key === "moment") return "moment";
	if (key === "album") return "album";
	return "media";
}

function currentTargetId(): string | undefined {
	if (isNew.value) {
		// 新建时：文章配图必须跟着 slug 走（否则没法放进 bundle）；
		// 相册封面统一放独立目录 public/gallery/_covers/，避免提前创建相册目录
		if (type.value === "post") return newId.value.trim() || undefined;
		return undefined;
	}
	if (type.value === "album") return String(fields.value.id ?? idParam.value);
	return idParam.value;
}

async function uploadForBody(file: File): Promise<string> {
	const targetType = targetTypeForUpload();
	const targetId = currentTargetId();
	if (targetType === "post" && !targetId) {
		throw new Error("请先填写 slug（文章图片会存到 posts/<slug>/images 目录）");
	}
	const result = await api.upload(targetType, targetId, file);
	ElMessage.success(result.deduped ? "已复用相同图片" : "图片已上传");
	return `![${file.name.replace(/\.[^.]+$/, "")}](${result.reference})`;
}

async function saveDoc(showMessage = true): Promise<boolean> {
	saving.value = true;
	try {
		const payload: { id?: string; fields: Record<string, unknown>; body?: string } = {
			fields: fields.value,
			body: body.value,
		};
		if (isNew.value && newId.value.trim()) payload.id = newId.value.trim();

		const result = isNew.value
			? await api.create(type.value, payload)
			: await api.update(type.value, idParam.value, payload);

		const warnings = result.warnings ?? [];
		const gitNote = result.git?.ok ? `，${result.git.message}` : "";
		if (warnings.length > 0) {
			ElMessage.warning(`已保存，但有问题：${warnings.join("；")}`);
		} else if (showMessage) {
			ElMessage.success(result.changed ? `已保存${gitNote}` : "内容无变化");
		}

		if (isNew.value) {
			router.replace(`/c/${type.value}/${encodeURIComponent(result.id)}`);
		}
		return true;
	} catch (error) {
		ElMessage.error((error as Error).message);
		return false;
	} finally {
		saving.value = false;
	}
}

function previewPath(): string {
	const key = type.value;
	const id = isNew.value ? newId.value : idParam.value;
	if (key === "post") {
		const slug = String(fields.value.slug ?? "") || id;
		return `/posts/${encodeURIComponent(slug)}/`;
	}
	if (key === "project") return `/projects/${encodeURIComponent(id)}/`;
	if (key === "moment") return "/dynamic/";
	if (key === "album") return `/gallery/${encodeURIComponent(String(fields.value.id ?? id))}/`;
	return "/";
}

async function openPreview(saveFirst: boolean): Promise<void> {
	if (saveFirst) {
		const ok = await saveDoc(false);
		if (!ok) return;
	}
	try {
		const { url } = await api.startDev();
		previewUrl.value = `${url}${previewPath()}`;
		previewVisible.value = true;
	} catch (error) {
		ElMessage.error(`预览启动失败：${(error as Error).message}`);
	}
}

async function removeDoc(): Promise<void> {
	try {
		await ElMessageBox.confirm(`确定删除「${idParam.value}」吗？`, "删除确认", { type: "warning" });
	} catch {
		return;
	}
	try {
		await api.remove(type.value, idParam.value);
		ElMessage.success("已删除");
		router.push(`/c/${type.value}`);
	} catch (error) {
		ElMessage.error((error as Error).message);
	}
}

function insertSnippet(kind: "mermaid" | "callout" | "code" | "image"): void {
	if (kind === "image") {
		ElMessage.info("直接粘贴或拖拽图片到编辑器即可上传");
		return;
	}
	if (!editorRef.value) return;
	const map = {
		mermaid: "\n```mermaid\nflowchart TD\n    A[开始] --> B{条件}\n    B -->|是| C[处理]\n    B -->|否| D[结束]\n```\n",
		callout: "\n> [!NOTE] 提示\n> 这里写内容\n",
		code: "\n```js\n// code\n```\n",
	};
	editorRef.value.insertText(map[kind]);
}

onMounted(load);
watch(() => route.fullPath, load);
</script>

<template>
	<div class="ff-page" v-loading="loading">
		<div class="ff-page-head">
			<div>
				<h2 class="ff-page-title">
					{{ isNew ? "新建" : "编辑" }}{{ meta?.label ?? "" }}
					<span v-if="!isNew" class="ff-mono" style="font-size: 14px; color: #909399">
						/ {{ idParam }}
					</span>
				</h2>
				<div class="ff-hint" v-if="meta?.hint">{{ meta.hint }}</div>
			</div>
			<div class="ff-toolbar">
				<el-button @click="router.push(`/c/${type}`)">返回列表</el-button>
				<el-button type="success" plain @click="openPreview(false)">预览</el-button>
				<el-button type="primary" :loading="saving" @click="openPreview(true)">保存并预览</el-button>
				<el-button type="primary" :loading="saving" @click="saveDoc()">保存</el-button>
				<el-button v-if="!isNew" type="danger" plain @click="removeDoc">删除</el-button>
			</div>
		</div>

		<div class="ff-editor-layout">
			<div class="ff-editor-side">
				<el-card shadow="never">
					<div v-if="needsIdInput" class="ff-id-row">
						<div class="ff-field-label" style="text-align: left; padding: 0 0 6px">
							{{ meta?.idLabel }}
							<span class="ff-required" v-if="!idOptional">*</span>
						</div>
						<div style="display: flex; gap: 8px">
							<el-input
								v-model="newId"
								:placeholder="
									idField?.placeholder ?? (idOptional ? '留空自动按时间生成' : '例如 my-first-post')
								"
								class="ff-mono"
							/>
							<el-button v-if="meta?.key === 'post' || meta?.key === 'project'" @click="guessSlug">
								用标题生成
							</el-button>
						</div>
						<div class="ff-hint">
							{{ idField?.hint ?? "小写字母、数字、连字符；创建后请勿修改（会导致链接失效）" }}
						</div>
					</div>

					<el-collapse v-model="activeGroups">
						<el-collapse-item v-for="group in groups" :key="group.key" :name="group.key">
							<template #title>
								<span style="font-weight: 600">{{ group.label }}</span>
								<el-tag v-if="group.key === 'security'" size="small" type="warning" style="margin-left: 8px">
									明文写入 git
								</el-tag>
							</template>
							<FieldInput
								v-for="field in group.fields"
								:key="field.name"
								:field="field"
								:model-value="fields[field.name]"
								:target-type="targetTypeForUpload()"
								:target-id="currentTargetId()"
								:image-options="field.name === 'cover' ? albumPhotos : undefined"
								:disabled="Boolean(field.immutable)"
								@update:model-value="fields[field.name] = $event"
							/>
						</el-collapse-item>
					</el-collapse>
				</el-card>
			</div>

			<div class="ff-editor-main">
				<el-card shadow="never" v-if="meta?.hasBody">
					<template #header>
						<div class="ff-toolbar" style="justify-content: space-between">
							<span>正文（Markdown）</span>
							<div class="ff-toolbar">
								<el-button size="small" @click="insertSnippet('callout')">Callout</el-button>
								<el-button size="small" @click="insertSnippet('mermaid')">Mermaid</el-button>
								<el-button size="small" @click="insertSnippet('code')">代码块</el-button>
								<el-button size="small" type="primary" plain @click="insertSnippet('image')">
									图片说明
								</el-button>
							</div>
						</div>
					</template>
					<MarkdownEditor
						ref="editorRef"
						v-model="body"
						:on-upload-image="uploadForBody"
						placeholder="正文内容，支持 Mermaid / Callout / KaTeX / 图片粘贴上传"
					/>
					<div class="ff-hint" style="margin-top: 8px">
						直接粘贴或拖拽图片会自动上传到目标目录并插入 Markdown。
					</div>
				</el-card>
				<el-card shadow="never" v-else>
					<div class="ff-hint">
						该类型没有正文。相册照片请保存后到「相册详情」里管理。
					</div>
				</el-card>
			</div>
		</div>

		<el-drawer v-model="previewVisible" title="预览（dev server 实时渲染）" size="72%">
			<div class="ff-hint" style="margin-bottom: 8px">
				预览基于已保存内容，由 <code>astro dev</code> 渲染，与线上最终效果基本一致。
				<a :href="previewUrl" target="_blank" rel="noreferrer">在新窗口打开</a>
			</div>
			<iframe v-if="previewUrl" :src="previewUrl" class="ff-preview-frame" />
		</el-drawer>
	</div>
</template>

<style scoped>
.ff-editor-layout {
	display: grid;
	grid-template-columns: minmax(360px, 460px) minmax(0, 1fr);
	gap: 16px;
	align-items: start;
}

@media (max-width: 1100px) {
	.ff-editor-layout {
		grid-template-columns: minmax(0, 1fr);
	}
}

.ff-editor-side {
	position: sticky;
	top: 8px;
}

.ff-id-row {
	margin-bottom: 12px;
	padding-bottom: 12px;
	border-bottom: 1px solid #f0f2f5;
}

.ff-required {
	color: #f56c6c;
}

.ff-preview-frame {
	width: 100%;
	height: calc(100vh - 180px);
	border: 1px solid var(--ff-border);
	border-radius: 8px;
	background: #fff;
}
</style>
