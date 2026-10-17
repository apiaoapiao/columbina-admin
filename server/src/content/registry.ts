import type { FieldDef } from "./frontmatter.ts";

export type ContentTypeKey = "post" | "moment" | "project" | "album" | "friend";
export type ContentKind = "md-bundle" | "md-file" | "ts-array";

export interface ContentTypeDef {
	key: ContentTypeKey;
	label: string;
	/** 写入策略 */
	kind: ContentKind;
	/** md 类：内容根目录（相对仓库根）；ts-array：关联的图片目录 */
	root: string;
	/** ts-array 配置文件名（相对仓库根） */
	configFile?: string;
	/** ts-array 在配置对象里的数组属性名 */
	configProp?: string;
	/** 配置变量名 */
	configVar?: string;
	/** id 的展示名 */
	idLabel: string;
	titleField: string;
	dateField: string | null;
	hasBody: boolean;
	fields: FieldDef[];
	/** 列表页展示的字段 */
	listFields: string[];
	/** 默认排序 */
	defaultSort: "published-desc" | "order-asc" | "weight-desc";
	hint?: string;
}

const POST_FIELDS: FieldDef[] = [
	{ name: "title", label: "标题", type: "string", required: true, group: "basic" },
	{
		name: "published",
		label: "发布日期",
		type: "date",
		required: true,
		group: "basic",
		hint: "必须是不带引号的 YYYY-MM-DD",
	},
	{ name: "updated", label: "更新日期", type: "date", group: "display", hint: "留空则不写" },
	{
		name: "description",
		label: "摘要",
		type: "text",
		group: "basic",
		hint: "显示在首页卡片；含冒号/井号会自动加引号",
	},
	{
		name: "image",
		label: "封面图",
		type: "image",
		group: "display",
		hint: "支持 ./images/x.webp、/public 路径、https 链接、或字面量 api（随机封面）",
	},
	{ name: "tags", label: "标签", type: "tags", group: "basic" },
	{ name: "category", label: "分类", type: "string", group: "basic" },
	{
		name: "draft",
		label: "草稿",
		type: "boolean",
		group: "basic",
		default: true,
		hint: "新建默认草稿，发布时关闭",
	},
	{ name: "pinned", label: "置顶", type: "boolean", group: "display", default: false },
	{
		name: "series",
		label: "所属系列",
		type: "string",
		group: "display",
		hint: "同名文章会归为一组，名称必须完全一致",
	},
	{ name: "seriesOrder", label: "系列序号", type: "number", group: "display" },
	{ name: "lang", label: "语言", type: "string", group: "advanced", placeholder: "zh-CN" },
	{ name: "author", label: "作者", type: "string", group: "advanced" },
	{ name: "comment", label: "启用评论", type: "boolean", group: "advanced", default: true },
	{ name: "licenseName", label: "许可证名称", type: "string", group: "advanced" },
	{ name: "licenseUrl", label: "许可证链接", type: "string", group: "advanced" },
	{ name: "sourceLink", label: "来源链接", type: "string", group: "advanced" },
	{
		name: "password",
		label: "文章密码",
		type: "string",
		group: "security",
		hint: "⚠️ 密码会以明文写入 md 并进入 git 历史，公开仓库请勿使用真实密码",
	},
	{ name: "passwordHint", label: "密码提示", type: "string", group: "security" },
];

const MOMENT_FIELDS: FieldDef[] = [
	{
		name: "published",
		label: "发布时间",
		type: "datetime",
		required: true,
		group: "basic",
		hint: "按字面值显示（YYYY-MM-DD HH:mm:ss），不会转 UTC",
	},
	{ name: "pinned", label: "置顶", type: "boolean", group: "basic", default: false },
	{ name: "location", label: "位置", type: "string", group: "basic" },
];

const PROJECT_FIELDS: FieldDef[] = [
	{ name: "title", label: "项目名", type: "string", required: true, group: "basic" },
	{ name: "published", label: "日期", type: "date", required: true, group: "basic" },
	{ name: "draft", label: "草稿", type: "boolean", group: "basic", default: false },
	{ name: "order", label: "排序", type: "number", group: "basic", hint: "数字越小越靠前" },
	{ name: "description", label: "简介", type: "text", group: "basic" },
	{ name: "image", label: "封面图", type: "image", group: "display" },
	{ name: "tags", label: "标签", type: "tags", group: "basic" },
	{ name: "status", label: "状态", type: "string", group: "basic", placeholder: "active / archived" },
	{
		name: "link",
		label: "外链",
		type: "links",
		group: "display",
		hint: "label / icon / value 三元组，icon 用 astro-icon 名称如 fa7-brands:github",
	},
	{ name: "lang", label: "语言", type: "string", group: "advanced" },
];

const ALBUM_FIELDS: FieldDef[] = [
	{
		name: "id",
		label: "相册 ID",
		type: "string",
		required: true,
		immutable: true,
		group: "basic",
		placeholder: "例如 japan-2025",
		hint: "同时作为图片目录名和 URL：/gallery/<相册ID>/。只能用小写字母、数字、连字符，且以字母或数字开头；创建后不可修改",
	},
	{ name: "name", label: "相册名称", type: "string", required: true, group: "basic" },
	{ name: "description", label: "描述", type: "text", group: "basic" },
	{ name: "date", label: "日期", type: "string", group: "basic", placeholder: "2025-04-10" },
	{ name: "location", label: "地点", type: "string", group: "basic" },
	{ name: "tags", label: "标签", type: "tags", group: "basic" },
	{
		name: "cover",
		label: "封面",
		type: "image",
		group: "display",
		hint: "留空则自动用 cover.* 或第一张图。可点【上传】落到相册目录，或从下拉里选相册内照片；新建时还没填相册 ID 的话，上传的图会放到 public/gallery/_covers/",
	},
	{ name: "password", label: "相册密码", type: "string", group: "security" },
	{ name: "passwordHint", label: "密码提示", type: "string", group: "security" },
];

const FRIEND_FIELDS: FieldDef[] = [
	{ name: "title", label: "站点名", type: "string", required: true, group: "basic" },
	{ name: "imgurl", label: "头像 URL", type: "string", required: true, group: "basic" },
	{ name: "desc", label: "描述", type: "string", required: true, group: "basic" },
	{ name: "siteurl", label: "站点地址", type: "string", required: true, group: "basic" },
	{ name: "tags", label: "标签", type: "tags", group: "basic" },
	{
		name: "weight",
		label: "权重",
		type: "number",
		required: true,
		group: "basic",
		default: 5,
		hint: "数字越大越靠前",
	},
	{
		name: "enabled",
		label: "启用",
		type: "boolean",
		group: "basic",
		default: true,
		hint: "停用请设为 false，不要删除",
	},
];

export const CONTENT_TYPES: Record<ContentTypeKey, ContentTypeDef> = {
	post: {
		key: "post",
		label: "文章",
		kind: "md-bundle",
		root: "src/content/posts",
		idLabel: "slug",
		titleField: "title",
		dateField: "published",
		hasBody: true,
		fields: POST_FIELDS,
		listFields: ["title", "published", "category", "tags", "draft", "pinned"],
		defaultSort: "published-desc",
		hint: "以目录 bundle 形式存放：posts/<slug>/index.md，图片放同名 images/ 目录",
	},
	moment: {
		key: "moment",
		label: "动态",
		kind: "md-file",
		root: "src/content/dynamic",
		idLabel: "文件名",
		titleField: "published",
		dateField: "published",
		hasBody: true,
		fields: MOMENT_FIELDS,
		listFields: ["published", "location", "pinned"],
		defaultSort: "published-desc",
		hint: "文件名即 URL，编辑时间只改 frontmatter，绝不重命名文件",
	},
	project: {
		key: "project",
		label: "项目",
		kind: "md-file",
		root: "src/content/projects",
		idLabel: "slug",
		titleField: "title",
		dateField: "published",
		hasBody: true,
		fields: PROJECT_FIELDS,
		listFields: ["title", "published", "status", "tags", "draft"],
		defaultSort: "order-asc",
		hint: "正文即项目 README，渲染在详情页底部",
	},
	album: {
		key: "album",
		label: "相册",
		kind: "ts-array",
		root: "public/gallery",
		configFile: "src/config/galleryConfig.ts",
		configProp: "albums",
		configVar: "galleryConfig",
		idLabel: "相册 ID（目录名）",
		titleField: "name",
		dateField: "date",
		hasBody: false,
		fields: ALBUM_FIELDS,
		listFields: ["name", "date", "location", "tags"],
		defaultSort: "published-desc",
		hint: "照片放 public/gallery/<id>/，构建时自动扫描；元信息写入 galleryConfig.ts",
	},
	friend: {
		key: "friend",
		label: "友链",
		kind: "ts-array",
		root: "",
		configFile: "src/config/friendsConfig.ts",
		configVar: "friendsConfig",
		idLabel: "序号",
		titleField: "title",
		dateField: null,
		hasBody: false,
		fields: FRIEND_FIELDS,
		listFields: ["title", "desc", "weight", "enabled"],
		defaultSort: "weight-desc",
		hint: "写入 friendsConfig.ts 的数组，停用请设 enabled: false",
	},
};

const TYPE_KEYS = Object.keys(CONTENT_TYPES) as ContentTypeKey[];

export function isContentTypeKey(value: string): value is ContentTypeKey {
	return (TYPE_KEYS as string[]).includes(value);
}

export function getType(key: string): ContentTypeDef {
	if (!isContentTypeKey(key)) {
		throw new Error(`未知内容类型：${key}（可选：${TYPE_KEYS.join(", ")}）`);
	}
	return CONTENT_TYPES[key];
}

export function defaultValues(def: ContentTypeDef): Record<string, unknown> {
	const values: Record<string, unknown> = {};
	for (const field of def.fields) {
		if (field.default !== undefined) values[field.name] = field.default;
		else if (field.type === "tags" || field.type === "links") values[field.name] = [];
		else if (field.type === "boolean") values[field.name] = false;
		else if (field.type === "number") values[field.name] = undefined;
		else values[field.name] = "";
	}
	return values;
}
