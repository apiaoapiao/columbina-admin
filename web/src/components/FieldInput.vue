<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { api, toAssetUrl, type FieldDef, type UploadResult } from "../api.ts";

const props = defineProps<{
	field: FieldDef;
	modelValue: unknown;
	targetType: "post" | "moment" | "album" | "media";
	targetId?: string;
	seriesOptions?: string[];
	/** image 字段可选的候选图片（如相册内的照片），用于下拉选择 */
	imageOptions?: Array<{ label: string; value: string }>;
	/** 只读（用于 immutable 字段，如 albumId） */
	disabled?: boolean;
}>();

const emit = defineEmits<{ "update:modelValue": [unknown] }>();

const uploading = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

function update(value: unknown): void {
	emit("update:modelValue", value);
}

const textValue = computed(() => (props.modelValue === undefined || props.modelValue === null ? "" : String(props.modelValue)));

const tagValue = computed(() => {
	const value = props.modelValue;
	return Array.isArray(value) ? value.map(String) : [];
});

const linkValue = computed(() => {
	const value = props.modelValue;
	if (!Array.isArray(value)) return [] as Array<Record<string, string>>;
	return value as Array<Record<string, string>>;
});

const numValue = computed(() => {
	const value = props.modelValue;
	if (value === undefined || value === null || value === "") return undefined;
	const num = Number(value);
	return Number.isFinite(num) ? num : undefined;
});

const isImageLike = computed(() => {
	const value = textValue.value.trim();
	if (!value) return false;
	if (value === "api") return false;
	return /^(\/|https?:|\.\/)/.test(value);
});

/** 值变化时换一个版本号，强制浏览器重新拉图（同名文件内容可能已变） */
const previewVersion = ref(Date.now());
watch(
	() => props.modelValue,
	() => {
		previewVersion.value = Date.now();
	},
);

/** 后台可显示的图片地址（相对路径无法解析，返回空） */
const previewUrl = computed(() => toAssetUrl(textValue.value, previewVersion.value));

function onPickOption(value: string): void {
	update(value);
}

function pickFile(): void {
	fileInput.value?.click();
}

async function onFilePicked(event: Event): Promise<void> {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	input.value = "";
	if (!file) return;
	uploading.value = true;
	try {
		const result: UploadResult = await api.upload(props.targetType, props.targetId, file);
		update(result.reference);
		ElMessage.success(result.deduped ? "已复用相同图片" : `已上传（${result.width}×${result.height}）`);
	} catch (error) {
		ElMessage.error((error as Error).message);
	} finally {
		uploading.value = false;
	}
}

function addLink(): void {
	update([...linkValue.value, { label: "", icon: "", value: "" }]);
}

function updateLink(index: number, key: string, value: string): void {
	const next = linkValue.value.map((item, i) => (i === index ? { ...item, [key]: value } : item));
	update(next);
}

function removeLink(index: number): void {
	update(linkValue.value.filter((_, i) => i !== index));
}
</script>

<template>
	<div class="ff-field">
		<div class="ff-field-label">
			{{ field.label }}
			<span v-if="field.required" class="ff-required">*</span>
		</div>
		<div class="ff-field-control">
			<el-switch
				v-if="field.type === 'boolean'"
				:model-value="Boolean(modelValue)"
				:disabled="disabled"
				@update:model-value="update"
			/>

			<el-input-number
				v-else-if="field.type === 'number'"
				:model-value="numValue"
				:controls="false"
				:disabled="disabled"
				style="width: 160px"
				placeholder="留空则不写入"
				@update:model-value="update"
			/>

			<el-date-picker
				v-else-if="field.type === 'date'"
				:model-value="textValue || undefined"
				type="date"
				value-format="YYYY-MM-DD"
				:disabled="disabled"
				placeholder="YYYY-MM-DD"
				style="width: 100%"
				@update:model-value="update"
			/>

			<el-date-picker
				v-else-if="field.type === 'datetime'"
				:model-value="textValue || undefined"
				type="datetime"
				value-format="YYYY-MM-DD HH:mm:ss"
				:disabled="disabled"
				placeholder="YYYY-MM-DD HH:mm:ss"
				style="width: 100%"
				@update:model-value="update"
			/>

			<el-select
				v-else-if="field.type === 'tags'"
				:model-value="tagValue"
				multiple
				filterable
				allow-create
				default-first-option
				:reserve-keyword="false"
				:disabled="disabled"
				placeholder="输入后回车新增"
				style="width: 100%"
				@update:model-value="update"
			/>

			<el-select
				v-else-if="field.type === 'select'"
				:model-value="textValue"
				clearable
				filterable
				allow-create
				:disabled="disabled"
				style="width: 100%"
				@update:model-value="update"
			>
				<el-option v-for="option in field.options ?? []" :key="option" :label="option" :value="option" />
			</el-select>

			<div v-else-if="field.type === 'image'" class="ff-image-field">
				<el-input
					:model-value="textValue"
					:disabled="disabled"
					:placeholder="field.placeholder ?? '图片路径 / URL / api'"
					@update:model-value="update"
				/>
				<el-button :loading="uploading" :disabled="disabled" @click="pickFile">上传</el-button>
				<el-select
					v-if="imageOptions && imageOptions.length > 0"
					:model-value="textValue"
					placeholder="从相册选择"
					clearable
					:disabled="disabled"
					style="width: 160px"
					@update:model-value="onPickOption"
				>
					<el-option
						v-for="option in imageOptions"
						:key="option.value"
						:label="option.label"
						:value="option.value"
					/>
				</el-select>
				<input ref="fileInput" type="file" accept="image/*" hidden @change="onFilePicked" />
				<div v-if="previewUrl" class="ff-image-preview">
					<el-image :src="previewUrl" fit="cover" class="ff-image-thumb">
						<template #error>
							<div class="ff-image-error">
								图片加载失败（文件可能已被删除或重命名）<br />
								<span class="ff-mono">{{ textValue }}</span>
							</div>
						</template>
					</el-image>
				</div>
				<div v-else-if="textValue && isImageLike" class="ff-hint" style="width: 100%">
					相对路径无法在后台预览（{{ textValue }}），构建后可在站点上查看
				</div>
			</div>

			<div v-else-if="field.type === 'links'" class="ff-links">
				<div v-for="(link, index) in linkValue" :key="index" class="ff-link-row">
					<el-input
						:model-value="link.label"
						placeholder="显示名"
						@update:model-value="updateLink(index, 'label', $event)"
					/>
					<el-input
						:model-value="link.icon"
						placeholder="图标（如 fa7-brands:github）"
						@update:model-value="updateLink(index, 'icon', $event)"
					/>
					<el-input
						:model-value="link.value"
						placeholder="链接"
						@update:model-value="updateLink(index, 'value', $event)"
					/>
					<el-button text type="danger" @click="removeLink(index)">删除</el-button>
				</div>
				<el-button size="small" @click="addLink">+ 添加链接</el-button>
			</div>

			<el-input
				v-else-if="field.type === 'text'"
				:model-value="textValue"
				type="textarea"
				:rows="3"
				:disabled="disabled"
				:placeholder="field.placeholder"
				@update:model-value="update"
			/>

			<el-input
				v-else
				:model-value="textValue"
				:placeholder="field.placeholder"
				:disabled="disabled"
				clearable
				@update:model-value="update"
			/>

			<div v-if="field.hint" class="ff-hint">{{ field.hint }}</div>
		</div>
	</div>
</template>

<style scoped>
.ff-field {
	display: grid;
	grid-template-columns: 108px minmax(0, 1fr);
	gap: 10px;
	align-items: start;
	padding: 8px 0;
	border-bottom: 1px dashed #f0f2f5;
}

.ff-field-label {
	font-size: 13px;
	color: #4b5563;
	padding-top: 6px;
	text-align: right;
	line-height: 1.4;
}

.ff-required {
	color: #f56c6c;
	margin-left: 2px;
}

.ff-field-control {
	min-width: 0;
}

.ff-image-field {
	display: flex;
	gap: 8px;
	align-items: center;
	flex-wrap: wrap;
}

.ff-image-preview {
	width: 100%;
	max-width: 220px;
	border: 1px solid #eee;
	border-radius: 6px;
	overflow: hidden;
}

.ff-image-thumb {
	display: block;
	width: 100%;
	height: 120px;
}

.ff-image-error {
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

.ff-links {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.ff-link-row {
	display: grid;
	grid-template-columns: 1fr 1.2fr 1.4fr auto;
	gap: 6px;
	align-items: center;
}
</style>
