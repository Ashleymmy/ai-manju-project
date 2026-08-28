import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';

const app = express();
const PORT = 3101;

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
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
  const { title, description } = req.body;

  const newProject = {
    id: String(projects.length + 1),
    title: title || 'Untitled Project',
    description: description || '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    user_id: req.user.id
  };

  projects.push(newProject);

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

  res.json({ success: true });
});

// Canvas Snapshot - Get
app.get('/api/projects/:id/snapshot', requireAuth, (req, res) => {
  res.json({
    success: true,
    data: {
      canvas_data: { nodes: [], edges: [] },
      updated_at: new Date().toISOString()
    }
  });
});

// Canvas Snapshot - Update
app.put('/api/projects/:id/snapshot', requireAuth, (req, res) => {
  res.json({
    success: true,
    data: {
      canvas_data: req.body.canvas_data || { nodes: [], edges: [] },
      updated_at: new Date().toISOString()
    }
  });
});

// AI Models
app.get('/api/ai/models', (req, res) => {
  res.json({
    success: true,
    data: {
      models: [
        { id: 'gpt-4', name: 'GPT-4' },
        { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' }
      ]
    }
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
  console.log('');
  console.log('Default credentials:');
  console.log('  Username: admin');
  console.log('  Password: admin12345');
});
