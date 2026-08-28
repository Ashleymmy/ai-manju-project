# Mock API 服务器

这是一个用于开发的 Mock API 服务器，提供认证、项目管理和基本 API 功能。

## 快速启动

### 方式 1: 使用启动脚本（推荐）

**Windows:**
```bash
start-dev.bat
```

**Linux/Mac:**
```bash
chmod +x start-dev.sh
./start-dev.sh
```

### 方式 2: 手动启动

1. 启动后端 API:
```bash
cd mock-api
npm start
```

2. 在另一个终端启动前端:
```bash
pnpm dev
```

## 访问地址

- **前端**: http://localhost:3000
- **后端 API**: http://localhost:3101
- **健康检查**: http://localhost:3101/health

## 默认账户

| 用户名 | 密码 | 角色 | 描述 |
|--------|------|------|------|
| admin | admin12345 | super_admin | 管理员账户 |
| user | user123 | user | 普通用户 |

## API 端点

### 认证 (Authentication)

- `POST /api/auth/register` - 注册新用户
- `POST /api/auth/login` - 登录
- `GET /api/auth/me` - 获取当前用户信息
- `POST /api/auth/logout` - 登出

### 项目 (Projects)

- `GET /api/projects` - 获取项目列表
- `POST /api/projects` - 创建新项目
- `GET /api/projects/:id` - 获取项目详情
- `PUT /api/projects/:id` - 更新项目
- `DELETE /api/projects/:id` - 删除项目

### 画布快照 (Canvas Snapshot)

- `GET /api/projects/:id/snapshot` - 获取画布快照
- `PUT /api/projects/:id/snapshot` - 更新画布快照

### AI 模型

- `GET /api/ai/models` - 获取可用模型列表

### 用户偏好

- `GET /api/user/preferences` - 获取用户偏好设置

## 示例请求

### 登录
```bash
curl -X POST http://localhost:3101/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin12345"}' \
  -c cookies.txt
```

### 获取当前用户
```bash
curl http://localhost:3101/api/auth/me -b cookies.txt
```

### 创建项目
```bash
curl -X POST http://localhost:3101/api/projects \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"title":"我的项目","description":"项目描述"}'
```

## 注意事项

⚠️ **这只是一个开发用的 Mock 服务器**

- 所有数据存储在内存中，重启后会丢失
- 不适合生产环境使用
- 没有实现完整的安全验证
- Session 数据不持久化

## 故障排除

### 端口已被占用

如果端口 3101 已被占用，可以修改 `mock-api/server.js` 中的 `PORT` 常量。

### 无法连接

确保：
1. Mock API 服务器正在运行
2. 前端配置了正确的 API 地址
3. 没有防火墙阻止连接

## 开发说明

### 添加新的 API 端点

在 `mock-api/server.js` 中添加新的路由：

```javascript
app.get('/api/your-endpoint', (req, res) => {
  res.json({
    success: true,
    data: { /* your data */ }
  });
});
```

### 修改默认账户

在 `mock-api/server.js` 中修改 `users` 数组。
