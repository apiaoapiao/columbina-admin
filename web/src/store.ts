import { reactive } from "vue";
import { api, type ContentTypeMeta, type SystemStatus } from "./api.ts";

export const store = reactive({
	meta: [] as ContentTypeMeta[],
	status: null as SystemStatus | null,
	metaLoaded: false,
	error: "",
	async ensureMeta(): Promise<ContentTypeMeta[]> {
		if (store.metaLoaded) return store.meta;
		const data = await api.meta();
		store.meta = data.types;
		store.metaLoaded = true;
		return store.meta;
	},
	typeMeta(key: string): ContentTypeMeta | undefined {
		return store.meta.find((item) => item.key === key);
	},
	async refreshStatus(): Promise<void> {
		try {
			store.status = await api.status();
			store.error = "";
		} catch (error) {
			store.error = (error as Error).message;
		}
	},
});

export function formatBytes(bytes: number): string {
	if (!bytes) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
