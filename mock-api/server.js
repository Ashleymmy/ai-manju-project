import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';

const app = express();
const PORT = 3101;

// Middleware
app.use(cors({
  origin: (origin, callback) => {
    // 开发环境放行所有 localhost/127.0.0.1 来源（Vite strictPort:false 时端口可能从 3000 漂移）
    if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Mock user database
const users = [
  {
    id: 1,
    username: 'admin',
    password: 'admin12345',
    display_name: 'Admin User',
    role: 'super_admin'
  },
  {
    id: 2,
    username: 'user',
    password: 'user123',
    display_name: 'Test User',
    role: 'user'
  }
];

// Mock projects
let projects = [
  {
    id: '1',
    title: '示例项目 1',
    description: '这是一个示例项目',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    user_id: 1
  }
];

// Mock sessions - store Bearer tokens
const sessions = new Map();

// 画布快照存储：按项目持久化（数据同步）
// value 形如 { project_id, version, data, created_at, updated_at }，data 为完整画布快照
const projectSnapshots = new Map();

// 异步任务结果存储（图片生成等）
const jobResults = new Map();

// AI 上游服务配置：全部从环境变量读取，不在代码中保存任何密钥。
//   AI_API_BASE_URL  OpenAI 兼容服务地址，如 http://192.168.x.x:18080/v1
//   AI_API_KEY       上游服务密钥
//   AI_TEXT_MODEL    文本/Agent 模型 ID（缺省时前端使用占位模型列表）
//   AI_IMAGE_MODEL   生图模型 ID
// 未配置时：文本/生图接口回退为纯 mock 响应，流程界面不受影响。
const AI_CONFIG = {
  baseURL: (process.env.AI_API_BASE_URL || '').replace(/\/+$/, ''),
  apiKey: process.env.AI_API_KEY || '',
  textModel: process.env.AI_TEXT_MODEL || '',
  imageModel: process.env.AI_IMAGE_MODEL || ''
};
const aiUpstreamEnabled = Boolean(AI_CONFIG.baseURL && AI_CONFIG.apiKey);

// Helper function to generate Bearer token
function generateToken() {
  return 'tok_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Helper to extract Bearer token
function getBearerToken(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return auth.substring(7);
  }
  return null;
}

// 带超时的上游请求
async function fetchWithTimeout(url, options = {}, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// 生图尺寸映射：前端传比例，上游需要具体分辨率
function upstreamImageSize(size) {
  const map = {
    '1:1': '1024x1024',
    '16:9': '1792x1024',
    '9:16': '1024x1792',
    '2:1': '2048x1024'
  };
  return map[size] || '1024x1024';
}

// 未配置上游时的占位图（内联 SVG data URI）
function placeholderImageDataUri(prompt) {
  const safe = String(prompt || '').slice(0, 30).replace(/[<>&"']/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#2a2a32"/><text x="50%" y="45%" font-family="sans-serif" font-size="24" fill="#888899" text-anchor="middle">占位图片（未配置 AI 上游）</text><text x="50%" y="55%" font-family="sans-serif" font-size="16" fill="#666677" text-anchor="middle">${safe}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

// Middleware to check authentication
function requireAuth(req, res, next) {
  const token = getBearerToken(req);

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Not authenticated'
    });
  }

  const session = sessions.get(token);

  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return res.status(401).json({
      success: false,
      error: 'Session expired'
    });
  }

  const user = users.find(u => u.id === session.userId);

  if (!user) {
    return res.status(401).json({
      success: false,
      error: 'User not found'
    });
  }

  req.user = user;
  req.token = token;
  next();
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Ping
app.get('/api/ping', (req, res) => {
  res.json({ success: true, message: 'pong' });
});

// Auth - Register
app.post('/api/auth/register', (req, res) => {
  const { username, password, display_name } = req.body;

  if (users.find(u => u.username === username)) {
    return res.status(400).json({
      success: false,
      error: 'Username already exists'
    });
  }

  const newUser = {
    id: users.length + 1,
    username,
    password,
    display_name: display_name || username,
    role: 'user'
  };

  users.push(newUser);

  res.json({
    success: true,
    data: {
      id: newUser.id,
      username: newUser.username,
      display_name: newUser.display_name,
      role: newUser.role
    }
  });
});

// Auth - Login (Bearer Token)
app.post('/api/auth/login', (req, res) => {
  const { username, password, remember } = req.body;

  const user = users.find(u => u.username === username && u.password === password);

  if (!user) {
    return res.status(401).json({
      success: false,
      error: 'Invalid credentials'
    });
  }

  const token = generateToken();
  const maxAge = remember ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000; // 30 days or 24 hours

  sessions.set(token, {
    userId: user.id,
    expiresAt: Date.now() + maxAge
  });

  res.json({
    success: true,
    data: {
      token: token,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role
      }
    }
  });
});

// Auth - Me (with Bearer token)
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({
    success: true,
    data: {
      id: req.user.id,
      username: req.user.username,
      display_name: req.user.display_name,
      role: req.user.role
    }
  });
});

// Auth - Logout (with Bearer token)
app.post('/api/auth/logout', requireAuth, (req, res) => {
  sessions.delete(req.token);
  res.json({ success: true });
});

// Projects - List
app.get('/api/projects', requireAuth, (req, res) => {
  res.json({
    success: true,
    data: projects
  });
});

// Projects - Create
app.post('/api/projects', requireAuth, (req, res) => {
  const { title, description, data } = req.body;
  const now = new Date().toISOString();

  const newProject = {
    id: String(projects.length + 1),
    title: title || 'Untitled Project',
    description: description || '',
    // 创建时携带的画布数据（聊天台建画布流程），作为项目内嵌数据持久化
    ...(data && typeof data === 'object' ? { data } : {}),
    created_at: now,
    updated_at: now,
    user_id: req.user.id
  };

  projects.push(newProject);

  // 携带画布数据时同步写入初始快照，保证「快照优先」的读取路径能拿到它
  if (newProject.data) {
    projectSnapshots.set(newProject.id, {
      project_id: newProject.id,
      version: 1,
      data: newProject.data,
      created_at: now,
      updated_at: now
    });
  }

  res.json({
    success: true,
    data: newProject
  });
});

// Projects - Get
app.get('/api/projects/:id', requireAuth, (req, res) => {
  const project = projects.find(p => p.id === req.params.id);

  if (!project) {
    return res.status(404).json({
      success: false,
      error: 'Project not found'
    });
  }

  res.json({
    success: true,
    data: project
  });
});

// Projects - Update
app.put('/api/projects/:id', requireAuth, (req, res) => {
  const projectIndex = projects.findIndex(p => p.id === req.params.id);

  if (projectIndex === -1) {
    return res.status(404).json({
      success: false,
      error: 'Project not found'
    });
  }

  const { title, description } = req.body;

  projects[projectIndex] = {
    ...projects[projectIndex],
    title: title !== undefined ? title : projects[projectIndex].title,
    description: description !== undefined ? description : projects[projectIndex].description,
    updated_at: new Date().toISOString()
  };

  res.json({
    success: true,
    data: projects[projectIndex]
  });
});

// Projects - Delete
app.delete('/api/projects/:id', requireAuth, (req, res) => {
  const projectIndex = projects.findIndex(p => p.id === req.params.id);

  if (projectIndex === -1) {
    return res.status(404).json({
      success: false,
      error: 'Project not found'
    });
  }

  projects.splice(projectIndex, 1);
  projectSnapshots.delete(req.params.id);

  res.json({ success: true });
});

// Canvas Snapshot - Get
app.get('/api/projects/:id/snapshot', requireAuth, (req, res) => {
  const stored = projectSnapshots.get(req.params.id);

  if (stored) {
    return res.json({
      success: true,
      data: stored
    });
  }

  // 无存储快照时保持旧响应结构（前端回退到项目内嵌数据/起始节点）
  res.json({
    success: true,
    data: {
      canvas_data: { nodes: [], edges: [] },
      updated_at: new Date().toISOString()
    }
  });
});

// Canvas Snapshot - Update（前端自动保存的写入入口，必须真正持久化）
app.put('/api/projects/:id/snapshot', requireAuth, (req, res) => {
  const incoming = req.body?.data ?? req.body?.canvas_data;

  if (!incoming || typeof incoming !== 'object') {
    return res.status(400).json({
      success: false,
      error: 'Missing snapshot data'
    });
  }

  const prev = projectSnapshots.get(req.params.id);
  const now = new Date().toISOString();
  const next = {
    project_id: req.params.id,
    version: (prev?.version || 0) + 1,
    data: incoming,
    created_at: prev?.created_at || now,
    updated_at: now
  };
  projectSnapshots.set(req.params.id, next);

  // 同步项目内嵌数据，保持「快照」与「项目 data」两条读取路径一致
  const project = projects.find(p => p.id === req.params.id);
  if (project) {
    project.data = incoming;
    project.updated_at = now;
  }

  res.json({
    success: true,
    data: next
  });
});

// AI Models
app.get('/api/ai/models', (req, res) => {
  // 配置上游时把真实模型 ID 作为默认项，保证前端选中的模型上游可用；
  // 未配置时回退占位列表（此时文本/生图接口走纯 mock 响应）。
  const textModels = aiUpstreamEnabled && AI_CONFIG.textModel
    ? [AI_CONFIG.textModel]
    : ['gpt-4', 'gpt-3.5-turbo', 'claude-3-opus'];
  const imageModels = aiUpstreamEnabled && AI_CONFIG.imageModel
    ? [AI_CONFIG.imageModel]
    : ['dall-e-3', 'stable-diffusion-xl'];

  res.json({
    success: true,
    data: {
      text_models: textModels.map(id => ({ id, name: id })),
      image_models: imageModels.map(id => ({ id, name: id })),
      default_text_model: textModels[0],
      default_image_model: imageModels[0],
      model_labels: {},
      model_provider_names: {}
    }
  });
});

// AI Text Generation - 转发上游 OpenAI 兼容接口（含工具调用），未配置时回退 mock
app.post('/api/ai/text', requireAuth, async (req, res) => {
  const { prompt, messages, model, tools, tool_choice, parallel_tool_calls } = req.body || {};

  const chatMessages = Array.isArray(messages) && messages.length
    ? messages
    : (prompt ? [{ role: 'user', content: prompt }] : null);

  if (!chatMessages) {
    return res.status(400).json({
      success: false,
      error: 'Either prompt or messages is required'
    });
  }

  if (aiUpstreamEnabled) {
    try {
      const upstreamBody = {
        model: model || AI_CONFIG.textModel,
        messages: chatMessages
      };
      // 必须转发工具定义并回传 tool_calls：画布 Agent 的「确认 → 执行」流程依赖它
      if (Array.isArray(tools) && tools.length) {
        upstreamBody.tools = tools;
        upstreamBody.tool_choice = tool_choice ?? 'auto';
        if (parallel_tool_calls !== undefined) upstreamBody.parallel_tool_calls = parallel_tool_calls;
      }

      const upstream = await fetchWithTimeout(`${AI_CONFIG.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${AI_CONFIG.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(upstreamBody)
      }, 120000);

      if (!upstream.ok) {
        throw new Error(`上游响应 ${upstream.status}: ${(await upstream.text()).slice(0, 300)}`);
      }

      const completion = await upstream.json();
      const choice = completion.choices?.[0] || {};
      const message = choice.message || {};

      return res.json({
        success: true,
        data: {
          content: message.content || '',
          text: message.content || '',
          model: completion.model || upstreamBody.model,
          tool_calls: message.tool_calls || [],
          finish_reason: choice.finish_reason || 'stop'
        }
      });
    } catch (error) {
      console.error('[Mock API] AI 文本上游调用失败，回退 mock 响应:', error.message);
    }
  }

  const lastUser = [...chatMessages].reverse().find(m => m && m.role === 'user');
  const lastText = typeof lastUser?.content === 'string' ? lastUser.content : (prompt || '');
  const content = `（Mock 响应：未配置可用的 AI 上游服务，设置 AI_API_BASE_URL / AI_API_KEY 后重试）\n已收到你的指令：${String(lastText).slice(0, 200)}`;
  res.json({
    success: true,
    data: {
      content,
      text: content,
      model: model || 'mock',
      tool_calls: [],
      finish_reason: 'stop'
    }
  });
});

// AI Image Generation - 任务制：先返回 job_id，异步完成后经 /api/jobs/:id 取结果
app.post('/api/ai/image/generations', requireAuth, (req, res) => {
  const { prompt, model, n = 1, size = 'auto' } = req.body || {};

  if (!prompt) {
    return res.status(400).json({
      success: false,
      error: 'Prompt is required'
    });
  }

  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const createdAt = new Date().toISOString();
  jobResults.set(jobId, { id: jobId, status: 'pending', created_at: createdAt });

  res.json({
    success: true,
    data: {
      job_id: jobId,
      status: 'pending'
    }
  });

  void (async () => {
    try {
      if (!aiUpstreamEnabled) throw new Error('AI 上游未配置');

      const upstream = await fetchWithTimeout(`${AI_CONFIG.baseURL}/images/generations`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${AI_CONFIG.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: model || AI_CONFIG.imageModel,
          prompt,
          n: Math.max(1, Math.min(15, Number(n) || 1)),
          size: upstreamImageSize(size),
          response_format: 'b64_json'
        })
      }, 120000);

      if (!upstream.ok) {
        throw new Error(`上游响应 ${upstream.status}: ${(await upstream.text()).slice(0, 300)}`);
      }

      const payload = await upstream.json();
      const images = (Array.isArray(payload.data) ? payload.data : [])
        .map((img, index) => ({
          id: `img_${Date.now()}_${index}`,
          b64_json: img.b64_json ? `data:image/png;base64,${img.b64_json}` : null,
          url: img.url || null,
          content_type: 'image/png',
          revised_prompt: img.revised_prompt || prompt
        }))
        .filter(img => img.b64_json || img.url);

      if (!images.length) throw new Error('上游未返回图片');

      jobResults.set(jobId, {
        id: jobId,
        status: 'succeeded',
        result: { images },
        created_at: createdAt,
        completed_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('[Mock API] AI 生图上游调用失败，回退占位图:', error.message);
      jobResults.set(jobId, {
        id: jobId,
        status: 'succeeded',
        result: {
          images: [{
            id: `img_mock_${Date.now()}`,
            b64_json: placeholderImageDataUri(prompt),
            content_type: 'image/svg+xml',
            revised_prompt: prompt
          }]
        },
        created_at: createdAt,
        completed_at: new Date().toISOString()
      });
    }
  })();
});

// AI Image Edit - 任务制占位（参考图编辑不在当前主流程内）
app.post('/api/ai/image/edits', requireAuth, (req, res) => {
  const jobId = `job_edit_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const createdAt = new Date().toISOString();
  jobResults.set(jobId, { id: jobId, status: 'pending', created_at: createdAt });

  res.json({
    success: true,
    data: {
      job_id: jobId,
      status: 'pending'
    }
  });

  setTimeout(() => {
    jobResults.set(jobId, {
      id: jobId,
      status: 'succeeded',
      result: {
        images: [{
          id: `img_edit_${Date.now()}`,
          b64_json: placeholderImageDataUri('图片编辑'),
          content_type: 'image/svg+xml'
        }]
      },
      created_at: createdAt,
      completed_at: new Date().toISOString()
    });
  }, 2000);
});

// Jobs - Get status（图片生成等异步任务轮询）
app.get('/api/jobs/:jobId', requireAuth, (req, res) => {
  const job = jobResults.get(req.params.jobId);

  if (!job) {
    return res.json({
      success: true,
      data: {
        id: req.params.jobId,
        status: 'pending',
        created_at: new Date().toISOString()
      }
    });
  }

  res.json({
    success: true,
    data: job
  });
});

// User Preferences
app.get('/api/user/preferences', requireAuth, (req, res) => {
  res.json({
    success: true,
    data: {
      theme: 'dark',
      language: 'zh-CN'
    }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Mock API server running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`AI upstream: ${aiUpstreamEnabled ? AI_CONFIG.baseURL : '未配置（文本/生图走 mock 响应）'}`);
  console.log('');
  console.log('Default credentials:');
  console.log('  Username: admin');
  console.log('  Password: admin12345');
});
