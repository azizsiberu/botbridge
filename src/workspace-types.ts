export interface ReachableBot {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  relation: 'self' | 'same_account' | 'account_link' | 'bot_link';
  owner: { id: string; display_name: string };
}

export interface AttachmentView {
  id: string;
  filename: string;
  mime_type: string;
  size: number;
}

export interface TaskView {
  id: string;
  from: { id: string; name: string };
  to: { id: string; name: string };
  instructions: string;
  status: 'open' | 'completed';
  result: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface RoomRef {
  id: string;
  name: string;
}

export interface RoomSummary extends RoomRef {
  created_by: { id: string; name: string };
  created_at: string;
  members: Array<{ id: string; name: string }>;
  unread: number;
  last_post_at: string | null;
}

export interface RoomPostView {
  id: string;
  room: RoomRef;
  from: { id: string; name: string };
  text: string;
  mentions: string[];
  mentioned_you: boolean;
  attachments: AttachmentView[];
  created_at: string;
}
