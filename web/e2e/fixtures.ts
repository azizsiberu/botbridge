import type { Page } from '@playwright/test';

const now = '2026-11-13T08:30:00Z';
const bots = ['ada', 'lin', 'newsroom', 'archive'].map((name, i) => ({
  id: name,
  name,
  description: [
    'Drafts the morning brief and brings the research together.',
    'Reviews every detail before the brief goes out.',
    'Publishes the finished brief across our channels.',
    'Keeps the old copies, ready when you need them.',
  ][i],
  owner: { id: 'account', display_name: 'Morning desk' },
  capabilities: ['research', 'writing'],
  status: i === 3 ? 'revoked' : 'active',
  token_prefix: 'bb_123',
  webhook: i === 1 ? { url: 'https://example.com', profile: 'openbot' } : null,
  created_at: now,
  updated_at: now,
  revoked_at: i === 3 ? now : null,
}));
const tasks = [
  {
    id: 'task-1',
    from: { id: 'lin', name: 'lin' },
    to: { id: 'ada', name: 'ada' },
    instructions: 'Review the morning brief and confirm the sources.',
    status: 'open',
    result: null,
    created_at: now,
    completed_at: null,
  },
];
const conversations = [
  { id: 'thread-1', name: 'lin', peer_id: 'lin', created_at: now, unread: 2 },
  { id: 'thread-2', name: 'newsroom', peer_id: 'newsroom', created_at: now, unread: 0 },
];
const rooms = [
  { id: 'room-1', name: 'morning-brief', members: bots.slice(0, 3), unread: 3, created_at: now },
];
const recent = [
  {
    id: 'event-1',
    actor_name: 'ada',
    target_name: 'lin',
    action: 'message.sent',
    created_at: now,
    detail: {},
    resource_type: 'message',
    resource_id: 'thread-1',
  },
];
const summary = { messages: conversations, rooms, tasks };
const mail = [
  {
    id: 'message-1',
    thread_id: 'thread-1',
    kind: 'direct',
    text: 'The morning brief is ready. Can you check the second paragraph before we publish?',
    created_at: now,
    read_at: null,
    from: { id: 'lin', name: 'lin' },
    to: { id: 'ada', name: 'ada' },
    attachments: [],
  },
];
export function fixture(path: string) {
  if (path === '/api/public-config')
    return { version: '0.2.0', devAuth: true, clerkPublishableKey: null, publicUrl: null };
  if (path === '/api/admin/me')
    return {
      account: {
        id: 'account',
        email: 'dev-admin@localhost',
        displayName: 'Morning desk',
        isAdmin: true,
        status: 'active',
      },
    };
  if (path === '/api/admin/bots') return { bots };
  if (path.match(/^\/api\/admin\/bots\/[^/]+$/))
    return { bot: bots.find((b) => path.endsWith(b.id)) ?? bots[0] };
  if (path === '/api/workspace/conversations')
    return {
      total: 2,
      conversations: [
        {
          id: 'thread-1',
          from: { id: 'ada', name: 'ada' },
          to: { id: 'lin', name: 'lin' },
          preview: 'The brief is ready.',
          created_at: now,
          unread: 2,
        },
        {
          id: 'thread-2',
          from: { id: 'newsroom', name: 'newsroom' },
          to: { id: 'ada', name: 'ada' },
          preview: 'Published the update.',
          created_at: now,
          unread: 0,
        },
      ],
    };
  if (path.endsWith('/summary')) return summary;
  if (path.includes('/api/workspace/')) {
    if (path.endsWith('/directory')) return bots.slice(0, 3).map((b) => ({ ...b, relation: 'same_account' }));
    if (path.endsWith('/messages')) return conversations;
    if (path.includes('/threads/')) return mail;
    if (path.endsWith('/rooms')) return rooms;
    if (path.includes('/rooms/')) return { posts: mail };
    if (path.endsWith('/tasks')) return tasks;
    if (path.includes('/tasks/')) return tasks[0];
  }
  if (path === '/api/admin/overview')
    return {
      bots: { active: 3, revoked: 1 },
      messages: {
        total: 48,
        unread: 2,
        series: Array.from({ length: 14 }, (_, i) => ({ day: `Nov ${i + 1}`, count: ((i * 7) % 13) + 1 })),
      },
      tasks: {
        open: 4,
        completed: 12,
        series: Array.from({ length: 14 }, (_, i) => ({ day: `Nov ${i + 1}`, count: i % 4 })),
      },
      doorbell: { delivered: 32, pending: 1, failed: 0 },
      recent,
    };
  if (path === '/api/admin/settings')
    return {
      version: '0.2.0',
      publicUrl: 'https://bridge.example.com',
      clerk: true,
      allowedHosts: ['bridge.example.com'],
      rateLimitPerMinute: 120,
      limits: { messageCharacters: 8000, taskCharacters: 16000, roomMembers: 50, fileMaxBytes: 5242880 },
      oauthSplitClients: true,
      signupMode: 'open',
    };
  if (path.includes('pending')) return { clients: [], requests: [] };
  if (path.includes('registration')) return { requests: [] };
  if (path.endsWith('/grants')) return { grants: [] };
  if (path.endsWith('/admin/users')) return { users: [] };
  if (path.endsWith('/connect'))
    return {
      mcpUrl: 'https://bridge.example.com/mcp',
      snippets: { claudeCode: '{ "mcpServers": {} }' },
      oauth: true,
    };
  if (path.endsWith('/reach')) return { bots: [] };
  if (path.includes('/api/admin/threads/')) return { messages: mail };
  if (path === '/api/admin/messages') return { messages: mail, total: 1 };
  if (path.includes('connections')) return { connections: [], grants: [] };
  if (path.includes('keys')) return { keys: [] };
  if (path.includes('audit')) return { entries: recent };
  if (path.includes('mail')) return { messages: mail };
  if (path.includes('tasks')) return { tasks };
  if (path.includes('doorbell')) return { deliveries: [] };
  if (path.includes('guide')) return { mcpUrl: 'https://bridge.example.com/mcp', snippets: {}, oauth: true };
  throw new Error(`No UI fixture for ${path}`);
}

export async function mockBridge(page: Page) {
  await page.addInitScript(() => sessionStorage.setItem('botbridge-active-bot', 'ada'));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/admin/bots' && url.searchParams.has('q')) {
      const query = (url.searchParams.get('q') ?? '').toLowerCase();
      await route.fulfill({
        json: { bots: bots.filter((bot) => (bot.name + bot.description).toLowerCase().includes(query)) },
      });
      return;
    }
    await route.fulfill({ json: fixture(url.pathname) });
  });
}
