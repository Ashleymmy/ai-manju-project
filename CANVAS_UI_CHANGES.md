# 画布工坊界面修改说明

## 修改日期
2026-08-27

## 修改内容

### 1. 添加返回按钮
**文件**: `ai-manhua-studio/client/src/pages/CanvasWorkspaceView.tsx`

在画布工坊项目列表页面顶部添加了返回按钮，点击后返回主页。

**代码位置**: 第 6816 行附近

**修改内容**:
- 添加了 `.canvas-workspace-header` 容器
- 包含返回按钮（使用 ChevronLeft 图标）
- 返回按钮调用 `navigate("/")` 返回首页
- 将原有的 `.scope-switch` 移到 header 容器内

### 2. 让页面布局铺满屏幕
**文件**: `ai-manhua-studio/client/src/index.css`

添加了新的 CSS 样式类 `.canvas-workspace-full`，覆盖默认的 `max-width` 限制。

**代码位置**: 第 685-714 行

**修改内容**:
- `.canvas-workspace-full`: 
  - `max-width: none !important` - 移除 1480px 的宽度限制
  - `min-height: calc(100vh - 82px)` - 确保页面至少占满视口高度
  
- `.canvas-workspace-header`:
  - 使用 flexbox 布局返回按钮和范围切换器
  - `gap: 18px` 提供合适的间距
  
- 响应式设计:
  - 小于 760px 的移动端，header 改为垂直排列

## 效果

### 修改前
- 页面内容限制在 1480px 宽度内，两侧留白
- 没有返回按钮，需要使用浏览器后退或手动修改 URL

### 修改后
- 页面内容铺满整个浏览器窗口
- 顶部左侧有明显的"返回"按钮，可快速返回主页
- 保持了原有的范围切换功能（个人/团队）

## 访问路径
http://localhost:3000/canvas

## 相关文件
1. `ai-manhua-studio/client/src/pages/CanvasWorkspaceView.tsx` - 页面组件
2. `ai-manhua-studio/client/src/index.css` - 全局样式

## 注意事项
- ⚠️ **未修改后端代码** - 严格遵守只修改前端界面的要求
- 样式使用 `!important` 确保覆盖原有的 `.page-content` 样式
- 返回按钮的样式继承了已有的 `.outline-button.small` 类
- 保持了响应式设计，在移动端也能正常显示
