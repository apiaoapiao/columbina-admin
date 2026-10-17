import { createRouter, createWebHistory } from "vue-router";

const routes = [
	{ path: "/", redirect: "/dashboard" },
	{ path: "/dashboard", name: "dashboard", component: () => import("./pages/Dashboard.vue") },
	{ path: "/c/:type", name: "list", component: () => import("./pages/ContentList.vue") },
	{ path: "/c/:type/new", name: "new", component: () => import("./pages/ContentEditor.vue") },
	{ path: "/c/:type/:id", name: "edit", component: () => import("./pages/ContentEditor.vue") },
	{ path: "/albums/:id", name: "album", component: () => import("./pages/AlbumDetail.vue") },
	{ path: "/media", name: "media", component: () => import("./pages/MediaLibrary.vue") },
	{ path: "/settings", name: "settings", component: () => import("./pages/Settings.vue") },
];

const router = createRouter({
	history: createWebHistory("/"),
	routes,
});

export default router;
