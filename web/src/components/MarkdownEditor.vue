<script setup lang="ts">
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { ElMessage } from "element-plus";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps<{
	modelValue: string;
	placeholder?: string;
	/** 返回要插入正文的 Markdown 文本 */
	onUploadImage?: (file: File) => Promise<string>;
}>();

const emit = defineEmits<{ "update:modelValue": [string] }>();

const host = ref<HTMLDivElement | null>(null);
let view: EditorView | null = null;

function build(): void {
	if (!host.value) return;
	view = new EditorView({
		doc: props.modelValue ?? "",
		extensions: [
			basicSetup,
			markdown(),
			EditorView.lineWrapping,
			EditorView.updateListener.of((update) => {
				if (update.docChanged) emit("update:modelValue", update.state.doc.toString());
			}),
			EditorView.domEventHandlers({
				paste: (event) => {
					void handlePaste(event);
				},
				drop: (event) => {
					const files = event.dataTransfer?.files;
					if (!files || files.length === 0 || !props.onUploadImage) return;
					const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
					if (images.length === 0) return;
					event.preventDefault();
					void uploadAll(images);
				},
			}),
		],
		parent: host.value,
	});
}

async function handlePaste(event: ClipboardEvent): Promise<void> {
	if (!props.onUploadImage || !event.clipboardData) return;
	const images: File[] = [];
	for (const item of Array.from(event.clipboardData.items)) {
		if (!item.type.startsWith("image/")) continue;
		const file = item.getAsFile();
		if (file) images.push(file);
	}
	if (images.length === 0) return;
	event.preventDefault();
	await uploadAll(images);
}

async function uploadAll(files: File[]): Promise<void> {
	for (const file of files) {
		try {
			const text = await props.onUploadImage!(file);
			if (text) insertText(text);
		} catch (error) {
			ElMessage.error((error as Error).message);
		}
	}
}

function insertText(text: string): void {
	if (!view) return;
	const { from, to } = view.state.selection.main;
	view.dispatch({
		changes: { from, to, insert: text },
		selection: { anchor: from + text.length },
		scrollIntoView: true,
	});
	view.focus();
}

function getSelection(): string {
	if (!view) return "";
	const { from, to } = view.state.selection.main;
	return view.state.sliceDoc(from, to);
}

defineExpose({ insertText, getSelection });

onMounted(build);

onBeforeUnmount(() => {
	view?.destroy();
	view = null;
});

watch(
	() => props.modelValue,
	(value) => {
		if (!view) return;
		const current = view.state.doc.toString();
		if ((value ?? "") === current) return;
		view.dispatch({ changes: { from: 0, to: current.length, insert: value ?? "" } });
	},
);
</script>

<template>
	<div class="ff-cm" ref="host"></div>
</template>

<style scoped>
.ff-cm {
	border: 1px solid var(--ff-border);
	border-radius: 8px;
	overflow: hidden;
	background: #fff;
}

.ff-cm :deep(.cm-editor) {
	height: 520px;
	font-size: 13px;
}

.ff-cm :deep(.cm-scroller) {
	font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	line-height: 1.65;
}

.ff-cm :deep(.cm-editor.cm-focused) {
	outline: none;
}
</style>
