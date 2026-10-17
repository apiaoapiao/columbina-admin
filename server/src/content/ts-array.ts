import ts from "typescript";
import { readFile } from "node:fs/promises";
import { atomicWrite } from "../infra/fsx.ts";

export interface TreeNode {
	kind: "object" | "array" | "string" | "number" | "boolean" | "null" | "unknown";
	value?: unknown;
	properties?: Array<{ key: string; node: TreeNode }>;
	items?: TreeNode[];
	start: number;
	end: number;
}

function literalToNode(node: ts.Node, sf: ts.SourceFile): TreeNode {
	const start = node.getStart(sf);
	const end = node.getEnd();

	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
		return { kind: "string", value: node.text, start, end };
	}
	if (ts.isNumericLiteral(node)) {
		return { kind: "number", value: Number(node.text), start, end };
	}
	if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
		const operand = Number(node.operand.getText(sf));
		return { kind: "number", value: -operand, start, end };
	}
	if (node.kind === ts.SyntaxKind.TrueKeyword) {
		return { kind: "boolean", value: true, start, end };
	}
	if (node.kind === ts.SyntaxKind.FalseKeyword) {
		return { kind: "boolean", value: false, start, end };
	}
	if (node.kind === ts.SyntaxKind.NullKeyword) {
		return { kind: "null", value: null, start, end };
	}
	if (ts.isArrayLiteralExpression(node)) {
		const items = node.elements.map((el) => literalToNode(el, sf));
		return { kind: "array", items, value: items.map((i) => i.value), start, end };
	}
	if (ts.isObjectLiteralExpression(node)) {
		const properties: Array<{ key: string; node: TreeNode }> = [];
		for (const prop of node.properties) {
			if (!ts.isPropertyAssignment(prop)) continue;
			const keyText = prop.name.getText(sf).replace(/^['"]|['"]$/g, "");
			const child = literalToNode(prop.initializer, sf);
			properties.push({ key: keyText, node: child });
		}
		const value: Record<string, unknown> = {};
		for (const { key, node: child } of properties) value[key] = child.value;
		return { kind: "object", properties, value, start, end };
	}
	return { kind: "unknown", value: undefined, start, end };
}

function findProperty(
	node: ts.Node,
	propName: string,
	sf: ts.SourceFile,
): ts.Node | null {
	if (ts.isObjectLiteralExpression(node)) {
		for (const prop of node.properties) {
			if (!ts.isPropertyAssignment(prop)) continue;
			const keyText = prop.name.getText(sf).replace(/^['"]|['"]$/g, "");
			if (keyText === propName) return prop.initializer;
		}
	}
	let found: ts.Node | null = null;
	node.forEachChild((child) => {
		if (found) return;
		found = findProperty(child, propName, sf);
	});
	return found;
}

export interface TsArrayReadResult {
	items: unknown[];
	start: number;
	end: number;
	node: TreeNode;
	sourceText: string;
}

/**
 * 读取配置文件中的数组：
 * - propName 为空：`export const <varName> = [...]`（如 friendsConfig）
 * - propName 非空：`export const <varName> = { <propName>: [...] }`（如 galleryConfig.albums）
 */
export async function readTsArray(
	absFile: string,
	varName: string,
	propName?: string,
): Promise<TsArrayReadResult> {
	const sourceText = await readFile(absFile, "utf-8");
	const sf = ts.createSourceFile(absFile, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

	let initializer: ts.Node | null = null;
	const visit = (node: ts.Node): void => {
		if (initializer) return;
		if (ts.isVariableDeclaration(node) && node.name.getText(sf) === varName && node.initializer) {
			initializer = node.initializer;
			return;
		}
		node.forEachChild(visit);
	};
	visit(sf);

	if (!initializer) {
		throw new Error(`在 ${absFile} 中找不到变量 ${varName}`);
	}

	let arrayNode: ts.Node | null;
	if (propName) {
		arrayNode = findProperty(initializer, propName, sf);
		if (!arrayNode) {
			throw new Error(`在 ${absFile} 的 ${varName} 中找不到数组属性 ${propName}`);
		}
	} else {
		arrayNode = initializer;
	}
	if (!ts.isArrayLiteralExpression(arrayNode)) {
		throw new Error(`${absFile} 中 ${varName}${propName ? `.${propName}` : ""} 不是数组字面量`);
	}

	const node = literalToNode(arrayNode, sf);
	if (node.kind !== "array") throw new Error(`${propName} 不是数组字面量`);
	return {
		items: (node.items ?? []).map((item) => item.value),
		start: node.start,
		end: node.end,
		node,
		sourceText,
	};
}

const TAB = "\t";

function quoteString(value: string): string {
	const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n");
	return `"${escaped}"`;
}

function isIdentifierKey(key: string): boolean {
	return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key);
}

function serializeValue(value: unknown, indent: string): string {
	if (value === null || value === undefined) return "null";
	if (typeof value === "string") return quoteString(value);
	if (typeof value === "number") return Number.isFinite(value) ? String(value) : "0";
	if (typeof value === "boolean") return value ? "true" : "false";

	if (Array.isArray(value)) {
		if (value.length === 0) return "[]";
		const inner = indent + TAB;
		const items = value.map((item) => `${inner}${serializeValue(item, inner)},`);
		return `[\n${items.join("\n")}\n${indent}]`;
	}

	if (typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>).filter(
			([, v]) => v !== undefined,
		);
		if (entries.length === 0) return "{}";
		const inner = indent + TAB;
		const lines = entries.map(([key, val]) => {
			const safeKey = isIdentifierKey(key) ? key : quoteString(key);
			return `${inner}${safeKey}: ${serializeValue(val, inner)},`;
		});
		return `{\n${lines.join("\n")}\n${indent}}`;
	}

	return "null";
}

/** 计算数组开头 `[` 所在行的缩进 */
function indentOfArrayStart(sourceText: string, arrayStart: number): string {
	const lineStart = sourceText.lastIndexOf("\n", arrayStart) + 1;
	const lineText = sourceText.slice(lineStart, arrayStart);
	const match = lineText.match(/^[ \t]*/);
	return match ? match[0] : "";
}

export interface TsArrayWriteResult {
	changed: boolean;
	previous: unknown[];
	next: unknown[];
}

/** 只替换数组节点的文本区间，文件其余字节完全不动 */
export async function writeTsArray(
	absFile: string,
	varName: string,
	propName: string | undefined,
	nextItems: unknown[],
): Promise<TsArrayWriteResult> {
	const current = await readTsArray(absFile, varName, propName);
	const previous = current.items;
	if (JSON.stringify(previous) === JSON.stringify(nextItems)) {
		return { changed: false, previous, next: nextItems };
	}

	const baseIndent = indentOfArrayStart(current.sourceText, current.start);
	const itemIndent = baseIndent + TAB;

	// 保留原数组内部的注释行（模板提示），追加到新数组末尾
	const innerRaw = current.sourceText.slice(current.start + 1, current.end - 1);
	const comments = innerRaw
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.startsWith("//"));
	const commentBlock = comments.map((line) => `${itemIndent}${line}`).join("\n");

	const itemLines = nextItems.map((item) => `${itemIndent}${serializeValue(item, itemIndent)},`);
	const bodyParts = [...itemLines];
	if (commentBlock) bodyParts.push(commentBlock);

	const rendered =
		bodyParts.length === 0 ? "[]" : `[\n${bodyParts.join("\n")}\n${baseIndent}]`;

	const nextText =
		current.sourceText.slice(0, current.start) + rendered + current.sourceText.slice(current.end);

	// 语法校验：新文本必须能被 TypeScript 解析且无诊断
	const sf = ts.createSourceFile(
		absFile,
		nextText,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const diagnostics = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
	if (diagnostics.length > 0) {
		const message = diagnostics
			.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))
			.join("; ");
		throw new Error(`改写后的 TypeScript 存在语法错误：${message}`);
	}

	await atomicWrite(absFile, nextText);
	return { changed: true, previous, next: nextItems };
}
