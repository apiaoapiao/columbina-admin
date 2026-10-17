import matter from "gray-matter";
import { toLf } from "../infra/fsx.ts";

export type FieldType =
	| "string"
	| "text"
	| "date"
	| "datetime"
	| "number"
	| "boolean"
	| "tags"
	| "select"
	| "image"
	| "links";

export type FieldGroup = "basic" | "display" | "advanced" | "security";

export interface FieldDef {
	name: string;
	label: string;
	type: FieldType;
	required?: boolean;
	group?: FieldGroup;
	hint?: string;
	placeholder?: string;
	options?: string[];
	default?: unknown;
	/** 不允许在编辑时修改（如已发布文章的 slug） */
	immutable?: boolean;
}

export type FieldValue = string | number | boolean | string[] | ProjectLink[] | null | undefined;

export interface ProjectLink {
	label: string;
	icon?: string;
	value: string;
}

const DQ = '"';

/** YAML 需要引号的情况（保守策略：宁可多引，不可少引） */
export function needsQuote(value: string): boolean {
	if (value === "") return true;
	if (/^[\s]|[\s]$/.test(value)) return true;
	if (/[:#\[\]{}&*!|>'"%@`,]/.test(value)) return true;
	if (/^(true|false|null|yes|no|on|off|~)$/i.test(value)) return true;
	if (/^-?\d+(\.\d+)?$/.test(value)) return true;
	if (/^\d{4}-\d{2}-\d{2}/.test(value)) return true;
	if (value.includes("\n")) return true;
	return false;
}

function quote(value: string): string {
	const escaped = value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\r?\n/g, "\\n");
	return `${DQ}${escaped}${DQ}`;
}

function scalar(value: unknown): string {
	if (value === null || value === undefined) return '""';
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "number") return Number.isFinite(value) ? String(value) : '""';
	const text = String(value);
	return needsQuote(text) ? quote(text) : text;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 统一成 YYYY-MM-DD（按字面值，不做时区换算） */
export function formatDate(value: unknown): string {
	if (value instanceof Date) {
		return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
	}
	const text = String(value ?? "").trim();
	const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (match) return `${match[1]}-${match[2]}-${match[3]}`;
	const parsed = new Date(text);
	if (!Number.isNaN(parsed.getTime())) return formatDate(parsed);
	return "";
}

/** 统一成 YYYY-MM-DD HH:mm:ss（按字面值，不做时区换算） */
export function formatDateTime(value: unknown): string {
	if (value instanceof Date) {
		return `${formatDate(value)} ${pad2(value.getUTCHours())}:${pad2(value.getUTCMinutes())}:${pad2(value.getUTCSeconds())}`;
	}
	const text = String(value ?? "").trim().replace("T", " ");
	const match = text.match(/^(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
	if (match) {
		const [, date, hh = "00", mm = "00", ss = "00"] = match;
		return `${date} ${pad2(Number(hh))}:${pad2(Number(mm))}:${pad2(Number(ss))}`;
	}
	const parsed = new Date(text);
	if (!Number.isNaN(parsed.getTime())) return formatDateTime(parsed);
	return "";
}

function serializeInlineArray(items: unknown[]): string {
	if (items.length === 0) return "[]";
	return `[${items.map((item) => scalar(item)).join(", ")}]`;
}

function serializeLinks(links: ProjectLink[]): string {
	if (links.length === 0) return "[]";
	const lines = links.map((link) => {
		const parts = [
			`label: ${scalar(link.label ?? "")}`,
			`icon: ${scalar(link.icon ?? "")}`,
			`value: ${scalar(link.value ?? "")}`,
		];
		return `  - ${parts.join("\n    ")}`;
	});
	return `\n${lines.join("\n")}`;
}

/** 序列化 frontmatter（字段顺序由 fields 决定，稳定输出） */
export function stringifyFrontmatter(
	fields: FieldDef[],
	values: Record<string, unknown>,
): string {
	const lines: string[] = ["---"];
	const seen = new Set<string>();

	for (const field of fields) {
		seen.add(field.name);
		const value = values[field.name];
		if (value === undefined) continue;
		if (value === null) {
			lines.push(`${field.name}: ""`);
			continue;
		}

		switch (field.type) {
			case "date":
				lines.push(`${field.name}: ${formatDate(value)}`);
				break;
			case "datetime":
				lines.push(`${field.name}: ${formatDateTime(value)}`);
				break;
			case "number": {
				const num = Number(value);
				lines.push(`${field.name}: ${Number.isFinite(num) ? num : 0}`);
				break;
			}
			case "boolean":
				lines.push(`${field.name}: ${value ? "true" : "false"}`);
				break;
			case "tags": {
				const items = Array.isArray(value) ? value : [];
				lines.push(`${field.name}: ${serializeInlineArray(items)}`);
				break;
			}
			case "links": {
				const links = (Array.isArray(value) ? value : []) as ProjectLink[];
				const text = serializeLinks(links);
				lines.push(text.startsWith("\n") ? `${field.name}:${text}` : `${field.name}: ${text}`);
				break;
			}
			default:
				lines.push(`${field.name}: ${scalar(value)}`);
		}
	}

	// 保留未声明的额外字段（避免丢数据）
	for (const [key, value] of Object.entries(values)) {
		if (seen.has(key) || value === undefined) continue;
		if (value === null) {
			lines.push(`${key}: ""`);
		} else if (Array.isArray(value)) {
			const allPrimitive = value.every((v) => typeof v !== "object" || v === null);
			lines.push(
				allPrimitive
					? `${key}: ${serializeInlineArray(value)}`
					: `${key}: ${JSON.stringify(value)}`,
			);
		} else if (typeof value === "object") {
			lines.push(`${key}: ${JSON.stringify(value)}`);
		} else {
			lines.push(`${key}: ${scalar(value)}`);
		}
	}

	lines.push("---");
	return lines.join("\n");
}

export interface ParsedDoc {
	data: Record<string, unknown>;
	content: string;
}

export function parseDoc(raw: string): ParsedDoc {
	try {
		const parsed = matter(toLf(raw));
		return { data: parsed.data as Record<string, unknown>, content: parsed.content };
	} catch (error) {
		throw new Error(`frontmatter 解析失败：${(error as Error).message}`);
	}
}

export function buildDocument(
	fields: FieldDef[],
	values: Record<string, unknown>,
	body: string,
): string {
	const head = stringifyFrontmatter(fields, values);
	const normalizedBody = toLf(body ?? "").replace(/^\n+/, "");
	return `${head}\n\n${normalizedBody.trimEnd()}\n`;
}

function normalizeForCompare(value: unknown): unknown {
	if (value instanceof Date) return value.toISOString();
	if (Array.isArray(value)) return value.map(normalizeForCompare);
	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([k, v]) => [k, normalizeForCompare(v)]);
		return Object.fromEntries(entries);
	}
	return value;
}

function stableStringify(value: unknown): string {
	return JSON.stringify(normalizeForCompare(value));
}

/**
 * 写入前的强制 round-trip 校验：
 * 序列化 → 用 gray-matter 解析 → 逐字段比较。
 * 任何字段类型漂移（尤其是日期被写成字符串）都会在这里被拦下。
 */
export function verifyRoundTrip(
	fields: FieldDef[],
	values: Record<string, unknown>,
): string[] {
	const errors: string[] = [];
	let text: string;
	try {
		text = stringifyFrontmatter(fields, values);
	} catch (error) {
		return [`frontmatter 序列化失败：${(error as Error).message}`];
	}

	let parsed: Record<string, unknown>;
	try {
		parsed = matter(`${text}\n`).data as Record<string, unknown>;
	} catch (error) {
		return [`frontmatter 无法被重新解析：${(error as Error).message}`];
	}

	for (const field of fields) {
		const original = values[field.name];
		if (original === undefined) continue;
		const back = parsed[field.name];

		switch (field.type) {
			case "date": {
				if (!(back instanceof Date)) {
					errors.push(
						`字段 ${field.name} 写出后不是日期类型（${typeof back}），会导致 z.date() 校验失败`,
					);
				} else if (formatDate(back) !== formatDate(original)) {
					errors.push(`字段 ${field.name} 日期值发生变化：${formatDate(original)} → ${formatDate(back)}`);
				}
				break;
			}
			case "datetime": {
				const okType = back instanceof Date || typeof back === "string";
				if (!okType) {
					errors.push(`字段 ${field.name} 写出后类型异常（${typeof back}）`);
				} else if (formatDateTime(back) !== formatDateTime(original)) {
					errors.push(
						`字段 ${field.name} 时间值发生变化：${formatDateTime(original)} → ${formatDateTime(back)}`,
					);
				}
				break;
			}
			case "number": {
				if (typeof back !== "number") {
					errors.push(`字段 ${field.name} 写出后不是数字（${typeof back}）`);
				} else if (Number(back) !== Number(original)) {
					errors.push(`字段 ${field.name} 数值发生变化`);
				}
				break;
			}
			case "boolean": {
				if (typeof back !== "boolean") {
					errors.push(`字段 ${field.name} 写出后不是布尔值（${typeof back}）`);
				} else if (Boolean(back) !== Boolean(original)) {
					errors.push(`字段 ${field.name} 布尔值发生变化`);
				}
				break;
			}
			case "tags": {
				const originalItems = (Array.isArray(original) ? original : []).map(String);
				const backItems = (Array.isArray(back) ? back : []).map(String);
				if (stableStringify(originalItems) !== stableStringify(backItems)) {
					errors.push(`字段 ${field.name} 数组内容发生变化`);
				}
				break;
			}
			case "links": {
				const originalLinks = (Array.isArray(original) ? original : []) as ProjectLink[];
				const backLinks = (Array.isArray(back) ? back : []) as ProjectLink[];
				if (stableStringify(originalLinks) !== stableStringify(backLinks)) {
					errors.push(`字段 ${field.name} 链接数组发生变化`);
				}
				break;
			}
			default: {
				if (stableStringify(String(original ?? "")) !== stableStringify(String(back ?? ""))) {
					errors.push(`字段 ${field.name} 字符串内容发生变化`);
				}
			}
		}
	}

	return errors;
}
