import type { AdminConfig } from "./config.ts";
import type { ContentRepository } from "./content/repository.ts";
import type { MediaService } from "./infra/media.ts";
import type { ProcessManager } from "./infra/process.ts";

export interface AppDeps {
	config: AdminConfig;
	repo: ContentRepository;
	media: MediaService;
	pm: ProcessManager;
	startedAt: number;
	webDistDir: string;
	webDevUrl: string;
}
