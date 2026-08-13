# AI-Manju 漫剧资产助手 MG 操作动画

## 交付内容

- `ai-manju-asset-assistant-guide.svg`：1920×1080、48 秒循环、纯矢量动画主稿。
- `ai-manju-asset-assistant-guide.webm`：1920×1080、30 fps、VP9 视频成片。
- `ai-manju-asset-assistant-guide-poster.png`：1920×1080 视频封面。
- `index.html`：带暂停、重播、全屏和计时控制的 SVG 演示页。
- `storyboard.md`：分镜、字幕与建议配音稿。
- `record.html`、`render-video.mjs`：本地视频导出页面和脚本。

## 播放方式

推荐通过本地静态服务器打开交互演示：

```powershell
cd docs/media/asset-assistant-mg
python -m http.server 8788
```

浏览器访问：

```text
http://127.0.0.1:8788/
```

也可以直接播放 `ai-manju-asset-assistant-guide.webm`，或打开 `ai-manju-asset-assistant-guide.svg` 自动循环。

## 操作

- 空格：暂停或继续；
- `R`：重新播放；
- `F`：全屏；
- SVG 可导入 Figma、Illustrator 或支持 SVG 的动效工具继续编辑。

## 设计规格

- 画幅：16:9；
- 分辨率：1920×1080；
- 视频时长：约 47.97 秒；
- 视频帧率：30 fps；
- 视频编码：VP9 / WebM；
- 分镜：6 段，每段 8 秒；
- 风格：深色玻璃拟态、紫红蓝品牌渐变、MG UI 演示；
- 音频：当前版本无配音、无音乐，便于后续按发布渠道单独混音。

## 导出视频

项目提供基于 Microsoft Edge `MediaRecorder` 的本地导出脚本，不调用在线服务：

```powershell
node .\render-video.mjs 48 30 .\ai-manju-asset-assistant-guide.webm
```

参数依次为：时长（秒）、帧率、输出路径。脚本优先使用稳定的 VP9/WebM，并在导出后校验分辨率与时长。脚本依赖项目现有 Playwright 包和本机 Microsoft Edge。

## 内容边界

动画使用抽象 UI 和虚构项目《山海纪》，不包含真实账号、API Key、用户资产或付费 Provider 输出。
