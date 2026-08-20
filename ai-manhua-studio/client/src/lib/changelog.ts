/** 由 vite.config.ts 的 define 在构建期注入仓库根 CHANGELOG.md 内容。 */
declare const __APP_CHANGELOG__: string;

const changelog = typeof __APP_CHANGELOG__ === "string" ? __APP_CHANGELOG__ : "";

export default changelog;
