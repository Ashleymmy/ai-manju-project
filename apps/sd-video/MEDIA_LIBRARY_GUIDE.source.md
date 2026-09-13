# 媒体库功能实现指南

## 完成的工作

### 1. **数据库迁移** ✅
创建了 `migration_media_library.sql` 包含：
- **`media_library` 表**：存储所有用户媒体文件元数据
  - 支持上传文件（图片、视频）和生成视频
  - 自动生成缩微图路径
  - 关联任务和对话ID
  - RLS 安全策略

- **自动触发器**：视频生成成功时自动添加到媒体库
- **索引优化**：按用户、类型、时间加速查询

### 2. **后端功能** ✅

#### 新文件：`app/thumbnail_utils.py`
用于图片和视频缩微图处理：
```python
# 生成图片缩微图 (使用 Pillow)
await generate_image_thumbnail(image_data, size=(320, 180))

# 提取视频缩微图 (使用 ffmpeg)
await extract_video_thumbnail(video_path, timestamp="00:00:01")

# 获取媒体尺寸和信息
await get_image_dimensions(image_data)
await get_video_info(video_path)
```

#### 新API端点 (在 `routers.py`)：
- `GET /api/media/library` - 获取用户媒体库（支持类型过滤和分页）
- `GET /api/media/library/stats` - 获取媒体库统计（图片数、视频数、总大小）
- `DELETE /api/media/{item_id}` - 删除媒体项

#### 数据库函数 (在 `supabase_client.py`)：
- `add_to_media_library()` - 添加媒体到库
- `get_media_library()` - 查询媒体列表
- `delete_media_library_item()` - 删除媒体
- `get_media_library_stats()` - 获取统计

### 3. **前端UI** ✅

#### 新增界面元素：
- **侧边栏导航按钮**：新的"媒体库"菜单项（图标 `collections`）
- **媒体库视图**：
  - 响应式网格布局（2-5列，根据屏幕尺寸）
  - 每个媒体项显示缩微图
  - 悬停操作：查看图片、播放视频、删除
  - 文件信息卡：名称和上传日期
  - 类型过滤：全部/图片/视频
  - 统计信息：总数、图片数、视频数、总大小

#### 前端逻辑 (在 `app.js`)：
- 完整的状态管理
- `loadMediaLibrary()` - 加载媒体列表和统计
- `deleteMediaItem()` - 删除媒体
- `playMediaVideo()` / `viewMedia()` - 播放/查看
- 视频弹窗播放器

### 4. **依赖更新** ✅
在 `requirements.txt` 添加：
- `Pillow>=10.0.0` - 图片处理

---

## 部署步骤

### 第1步：运行数据库迁移
1. 打开 Supabase 控制台: https://supabase.com/dashboard
2. 进入 SQL Editor
3. 复制 `migration_media_library.sql` 的全部内容
4. 粘贴并执行
5. 验证：应该看到新表 `media_library` 出现

### 第2步：安装依赖
```bash
cd d:\Dev_project\Python_Project\SD_Video
pip install -r requirements.txt
# 或在虚拟环境中：
.\.venv\Scripts\activate
pip install Pillow
```

### 第3步：在服务器上安装 ffmpeg（仅当需要视频缩微图时）

#### Windows：
```bash
choco install ffmpeg
# 或下载：https://ffmpeg.org/download.html
```

#### macOS：
```bash
brew install ffmpeg
```

#### Linux (Ubuntu/Debian)：
```bash
sudo apt-get install ffmpeg
```

### 第4步：重启 FastAPI 服务
```bash
python main.py
```

---

## 工作流程

### 场景1：用户上传文件后自动保存到媒体库
```
用户上传参考图/首帧/尾帧
    ↓
文件保存到 Supabase Storage
    ↓
调用 POST /api/create_task
    ↓ (在创建任务时）
可选：调用 add_to_media_library() 添加上传文件
    ↓
媒体库中查看所有上传文件
```

### 场景2：视频生成完成后自动进入媒体库
```
视频生成任务完成
    ↓
状态更新为 'succeeded'
    ↓
数据库触发器激活
    ↓
自动调用 auto_add_generated_video_to_library()
    ↓
系统尝试提取视频缩微图（第一帧）
    ↓
缩微图保存到 Storage, 路径存入 media_library.thumbnail_path
    ↓
前端显示在媒体库网格中
```

### 场景3：显示媒体库
```
用户点击"媒体库"按钮
    ↓
前端调用 loadMediaLibrary()
    ↓
获取 GET /api/media/library?user_id=xxx
    ↓
获取 GET /api/media/library/stats?user_id=xxx
    ↓
为每个媒体生成签名链接（可临时访问）
    ↓
网格展示所有媒体 + 统计信息
```

---

## 数据结构

### media_library 表字段
```
id                UUID              主键
user_id           UUID              用户ID（fk）
name              TEXT              文件名称
file_type         TEXT              'image' | 'video'
media_type        TEXT              MIME类型
file_size         INTEGER           字节数
storage_path      TEXT              存储路径
thumbnail_path    TEXT              缩微图路径
source_type       TEXT              'uploaded' | 'generated'
task_id           UUID              关联任务（可选）
conversation_id   UUID              关联对话（可选）
width             INTEGER           宽度像素
height            INTEGER           高度像素
duration          INTEGER           视频时长（秒）
metadata          JSONB             额外信息（JSON）
created_at        TIMESTAMPTZ       创建时间
updated_at        TIMESTAMPTZ       更新时间
```

---

## API 文档

### 获取媒体库
```
GET /api/media/library
参数:
  - user_id: 必需
  - file_type: 可选 ('image'|'video'|null)
  - limit: 可选, 默认100
  - offset: 可选, 默认0

响应:
{
    "media": [
        {
            "id": "...",
            "name": "my-video.mp4",
            "file_type": "video",
            "storage_path": "...",
            "thumbnail_path": "...",
            "signed_url": "https://...",
            "thumbnail_signed_url": "https://...",
            "created_at": "2026-03-25T...",
            "duration": 5,
            ...
        }
    ]
}
```

### 获取统计
```
GET /api/media/library/stats?user_id=xxx

响应:
{
    "total_items": 42,
    "total_images": 28,
    "total_videos": 14,
    "total_size": 524288000  // 字节
}
```

### 删除媒体
```
DELETE /api/media/{item_id}?user_id=xxx

响应:
{"success": true}
```

---

## 前端使用示例

```javascript
// 加载媒体库
app.loadMediaLibrary();

// 按类型过滤
app.filterMediaType = 'image';  // 或 'video'
app.loadMediaLibrary();

// 查看统计
console.log(app.mediaStats);\
// {total_items: 42, total_images: 28, total_videos: 14, total_size: ...}

// 删除媒体
app.deleteMediaItem(media_id);

// 播放视频
app.playMediaVideo(media_object);

// 查看图片
app.viewMedia(media_object);
```

---

## 后续优化建议

### 可选功能1：为上传文件自动生成缩微图
在 `/api/create_task` 中修改上传逻辑：
```python
# 上传文件后，自动加入媒体库
if file_type.startswith('image/'):
    # 生成图片缩微图
    thumbnail_data = await generate_image_thumbnail(file_data)
    thumbnail_path = f"{user_id}/thumbnails/{ts}.jpg"
    await upload_file(thumbnail_path, thumbnail_data, "image/jpeg")

    await add_to_media_library(
        ...,
        thumbnail_path=thumbnail_path,
        width=image_width,
        height=image_height,
    )
```

### 可选功能2：批量导出
```python
@router.post("/api/media/export")
# 支持导出多个媒体为 ZIP
```

### 可选功能3：媒体分类/标签
为 `media_library` 表添加 `tags JSONB` 字段，支持用户为媒体添加标签

### 可选功能4：搜索和排序
- 按名称搜索
- 按上传日期/大小/时长排序

---

## 常见问题

**Q: 视频缩微图没有显示？**
A: 检查 ffmpeg 是否已安装。如果系统没有安装，可以跳过缩微图生成，直接使用原视频预览。

**Q: 媒体库加载很慢？**
A: 使用 `limit` 参数进行分页：`/api/media/library?user_id=xxx&limit=20&offset=0`

**Q: 上传的文件为什么没有自动加入媒体库？**
A: 目前只有**生成的视频**会自动添加。上传的文件需要手动调用 `add_to_media_library()`。可以在上传逻辑中修改。

**Q: 能不能限制用户上传/保存的媒体总大小？**
A: 可以在 API 中添加检查：`if mediaStats.total_size > LIMIT: raise exception`

---

## 文件清单

| 文件 | 类型 | 操作 |
|------|------|------|
| `migration_media_library.sql` | SQL | 新建 - 必须执行 |
| `app/thumbnail_utils.py` | Python | 新建 - 缩微图工具 |
| `app/supabase_client.py` | Python | 修改 - 添加媒体库函数 |
| `app/routers.py` | Python | 修改 - 添加API端点 |
| `requirements.txt` | 配置 | 修改 - 添加 Pillow |
| `app/template/index.html` | HTML | 修改 - 添加媒体库UI |
| `app/static/js/app.js` | JavaScript | 修改 - 添加媒体库逻辑 |

---

## 总结

你现在拥有了：
✅ 完整的媒体库数据模型\
✅ 自动添加生成视频的触发器\
✅ 缩微图提取工具（图片+视频）\
✅ REST API 端点\
✅ 专业的网格UI界面\
✅ 用户上传/生成内容追踪\

**下一步**：\
1. 执行 SQL 迁移脚本\
2. 安装 Pillow 和 ffmpeg\
3. 重启服务，测试媒体库功能
