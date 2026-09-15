# 画布引用缩略图、分组角标与批量主图修复验收

日期：2026-09-15

## 修复

- `promptTextFromNode` 优先读取原始 `composerContent`，保留 `@[node:...]`、`@[asset:...]` 引用标记；空字符串也作为有效的已清空输入处理。
- 文本、图片（含批量子节点）、视频、音频生成时保存原始输入。提交模型、失败重试和已入队任务恢复仍使用解析后的提示词，完成结果不会覆盖原始输入。
- 正式分组标题栏与顶部角标共用 `--canvas-group-header-offset`，顶部角标位于标题栏上方，跟随缩放对齐可见顶角。临时分组行为不变。
- 主图自身的 `status/errorDetails/jobId` 与整批 `batchStatus/batchErrorDetails` 分离。子图更新不再覆盖主图任务状态、任务编号或图片，不会因为主图先完成而一直停在生成中。
- 主图交换采用真实资产 ID，交换对应图片的提示词、引用和生成参数；主图或所选图片仍在生成时暂不交换，避免后续返回覆盖已交换的结果。
- 从文本创建图片、从历史版本恢复图片时，同步填入正确的原始输入，防止读到空输入或当前版本的引用。

## 验证及实际输出

使用项目指定的 pnpm 9.15.0 恢复锁文件对应依赖，没有修改锁文件。默认预装 pnpm 不兼容此项目配置。

Studio 类型检查：

```text
> ai-manhua-studio@1.0.0 check D:\AImanju4.0\apps\studio
> tsc --noEmit
Exit status 0
```

新增回归测试覆盖节点/资产引用、单图/批量、失败重试、再次生成、快照恢复、四张图片的全部 24 种返回顺序、取消与重试主图以及主图交换。原有 2 项批量主图失败已修复。

最终 Studio 全量测试：

```text
Test Files  119 passed (119)
     Tests  628 passed (628)
```

Studio 构建通过；依赖的协议包和导演台构建亦通过：

```text
✓ 2059 modules transformed.
✓ built in 2.73s
Exit status 0
```

Canvas Agent 测试通过（将项目内 pnpm 加入本次进程 PATH，避免嵌套脚本调用不兼容的默认 pnpm）：

```text
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

Director Desk：

```text
Test Files  87 passed (87)
     Tests  686 passed (686)
```

后端 build / vet / test 均已尝试，本机未提供 Go 命令，无法执行：

```text
The term 'go' is not recognized as a name of a cmdlet, function, script file, or executable program.
```

Worker 使用本机 bundled Python。compileall 通过；unittest 受环境依赖及 Windows 平台限制未通过：

```text
Listing 'worker'...
Ran 20 tests in 0.027s
FAILED (errors=10, skipped=1)
```

错误包含缺少 psycopg、billiard、httpx、celery、requests 等依赖，以及 Windows 不支持的信号。

`git diff --check` 通过。浏览器当前未登录，未完成真实画布的视觉验收；生成测试使用模拟供应商，没有发起付费生成。
