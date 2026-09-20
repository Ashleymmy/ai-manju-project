# 引用删除与光标显示修复

## 原因与修改

引用列表刷新会重新格式化图片之间的空隙。父组件确认编辑值之后，后续刷新仍重建 textarea 内容，补回删除的空隙并将光标移至末尾。现在通过序列化内容比较保留已同步的编辑布局，等待父组件确认期间也不覆盖本地编辑。必要的外部更新使用布局阶段同步并保留选区。

光标增加金色 2px 显示层，随画布缩放补偿宽度；选区、失焦和中文输入法组合期间交回原生行为。浏览器验证发现原生 input 监听器中的光标刷新早于 React 的 onChange，会让受控输入框恢复旧内容。已移除该监听，改由内容提交后的布局更新刷新光标。

## 实际检查结果

```text
Studio check: tsc --noEmit, exit 0
Studio test: Test Files 131 passed (131), Tests 726 passed (726)
Studio build: built in 2.86s, exit 0
Canvas Agent: tests 4, pass 4, fail 0
Director Desk: Test Files 87 passed (87), Tests 686 passed (686)
git diff --check: exit 0
```

Go 与 Python 命令在当前终端不可用，因此后端和 Worker 检查未执行成功。本次未修改这两个模块。Director Desk 构建保留既有的大体积 chunk 提示。

使用真实输入组件和画布 CSS 的临时页面验证，无需登录、不修改用户画布。已确认图片前后可见金色光标，原生删除事件的额外冲突在浏览器中复现后修正。

修正后的最终连续删除及输入操作受浏览器自动审批超时影响，未完成浏览器复验；不能将本记录理解为已通过完整画布端到端验收。相关删除、引用刷新与光标保持的组件回归测试通过。临时验证页面已删除。

## 图片自带留白（后续需求）

图片引用两侧各内置 0.25em 留白，整体作为一个原子引用选择、移动光标或删除。插入图片不再附加可单独删除的空格；相邻图片无需提示词空格也有间距。保存的引用内容保持原样，用户自行输入的空白仍可编辑，缩略图本身尺寸保持 2em。

新增 Backspace/Delete 测试覆盖相邻引用连同内置留白一次删除、不留下空格；更新插入与序列化测试。实际输出：

```text
Studio check: tsc --noEmit, exit 0
Studio test: Test Files 131 passed (131), Tests 728 passed (728)
Studio build: built in 2.85s, exit 0
git diff --check: exit 0
GET http://localhost:3100/: 200
```

本次留白修改未执行浏览器视觉验收。其他模块未修改，检查结果及环境限制见上文。
