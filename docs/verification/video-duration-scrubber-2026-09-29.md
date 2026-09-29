# 视频时长拖动设计验收

日期：2026-09-29。

## 本轮修正

视频工作台启用 `VideoDurationInput` 的可选 scrubber 外观：20px 圆形拖动手柄、6px 进度轨道、随手柄位置移动的秒数标签及已选进度填充。移除右上角固定秒数框，显示“拖动调节”提示。原有画布默认外观保留。

模型提供两个以上可用时长时，工作台均可拖动；只支持 5/10 秒等离散档位时自动吸附到支持值，不提交中间无效时长。正常范围保留“最大时长的一半位于轨道中点”的映射；若最大时长的一半不高于最小值，采用实际最短到最长的线性位置，不显示误导性中点刻度。仅一个固定时长或未提供时长范围时，继续显示原有固定选项或未知范围提示，不伪造可拖动范围。

修改：`ParamsBar.tsx`、视频 `styles.css`、共享 `VideoDurationInput.tsx`、对应样式和测试。未改变模型目录、生成 API 或收费逻辑；未部署。

## 验证

浏览器真实按住手柄，从当前值拖到最长、最短和中点，验证范围 4–15 秒、中点刻度 7.5 秒吸附到 8 秒，秒数标签和进度同步变化。还验证方向键、Home/End、自动时长、离散档位拖动、音频禁用及 H3 模式。

1920 / 1440 / 1024 / 390px 无控件重叠或横向溢出；窄屏开关实际点击命中正常。测试目录数据由浏览器拦截提供，不修改服务端配置；写请求拦截，没有提交生成任务。浏览器错误为零。桌面及手机截图已检查。

新增两项单元场景覆盖离散范围 5/10 秒及窄范围 8/10 秒，确保拖动和键盘只能选择目录支持的值。

完整浏览器记录和日志：`.tmp/video-duration-scrubber-20260929/`。效果图：`output/video-duration-scrubber/`。

## 命令记录

以下检查均退出 0。构建有包体积提示；Worker 在临时无网络容器中只读挂载当前源码执行。

Studio: pnpm --filter ai-manhua-studio check

```text

> ai-manhua-studio@1.0.0 check D:\AImanju4.0\apps\studio
> tsc --noEmit

```

Studio: pnpm --filter ai-manhua-studio test

```text

 Test Files  261 passed (261)
      Tests  2064 passed (2064)
   Start at  15:49:35
   Duration  12.83s (transform 26.69s, setup 0ms, collect 108.77s, tests 40.52s, environment 105.11s, prepare 24.25s)

```

Studio: pnpm --filter ai-manhua-studio build

```text
../dist/public/assets/index-u-itOdde.js                          763.10 kB │ gzip: 261.79 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 9.15s
```

API: go build ./... && go vet ./... && go test ./...（build、vet 无输出）

```text
ok  	github.com/ai-manju/api/internal/providerpresetmigration	(cached)
ok  	github.com/ai-manju/api/internal/queue	(cached)
ok  	github.com/ai-manju/api/internal/repository	(cached)
ok  	github.com/ai-manju/api/internal/router	(cached)
ok  	github.com/ai-manju/api/internal/sdvideo	(cached)
ok  	github.com/ai-manju/api/internal/service	(cached)
ok  	github.com/ai-manju/api/internal/storage	(cached)
ok  	github.com/ai-manju/api/internal/tagmigration	(cached)
```

Canvas Agent: pnpm --filter @basketikun/canvas-agent test

```text
ℹ tests 5
ℹ suites 0
ℹ pass 5
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 82.3533
```

Director Desk: pnpm --filter @ai-manju/director-desk test

```text

 Test Files  87 passed (87)
      Tests  689 passed (689)
   Start at  15:49:25
   Duration  114.06s (transform 1.47s, setup 10.31s, import 7.70s, tests 40.83s, environment 45.65s)

```

Worker: python -m compileall worker && python -m unittest discover -s tests

```text
.......
----------------------------------------------------------------------
Ran 275 tests in 4.099s

OK (skipped=27)
```

git diff --check 通过。
