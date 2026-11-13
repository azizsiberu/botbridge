import { api } from './api';
import type { ReachableBot } from '../../src/workspace-types';
import type { RoomSummary, RoomPostView } from '../../src/workspace-types';
import type { TaskView } from '../../src/workspace-types';
import type { AttachmentView } from '../../src/workspace-types';

export type Agent = Pick<ReachableBot, 'id' | 'name' | 'description' | 'capabilities'>;
export type { ReachableBot, RoomSummary, RoomPostView, TaskView, AttachmentView };
export interface Conversation {
  id: string;
  name: string;
  peer_id: string;
  created_at: string;
  unread: number;
}
export interface Summary {
  messages: Conversation[];
  rooms: { id: string; name: string; unread: number; created_at: string }[];
  tasks: Pick<TaskView, 'id' | 'from' | 'to' | 'status' | 'created_at'>[];
}
export interface Message {
  id: string;
  text: string;
  from: Pick<Agent, 'id' | 'name'>;
  to: Pick<Agent, 'id' | 'name'>;
  created_at: string;
  read_at: string | null;
  attachments: AttachmentView[];
}
export function base(bot: string) {
  return '/api/workspace/bots/' + encodeURIComponent(bot);
}
export function post<T>(url: string, body: unknown = {}) {
  return api<T>(url, { method: 'POST', body: JSON.stringify(body) });
}

export interface AccountConversation {
  id: string;
  created_at: string;
  preview: string;
  from: { id: string; name: string };
  to: { id: string; name: string };
  unread: number;
}

export { useData, usePageData } from './lib/use-request';
