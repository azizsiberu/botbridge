import { useState } from 'react';
import type { Bot } from '../api';
import { Empty, Button } from '../ui';
import { useData, type AccountConversation } from '../workspace-data';
import { Row, State } from './shared';

export function Home({ bots, revision, refresh }: { bots: Bot[]; revision: number; refresh: () => void }) {
  const [offset, setOffset] = useState(0);
  const state = useData<{ conversations: AccountConversation[]; total: number }>(
    '/api/workspace/conversations?offset=' + offset,
    revision,
  );
  return (
    <State {...state} data={state.data} refresh={refresh}>
      {state.data?.conversations.map((conversation) => {
        const sender = bots.find((bot) => bot.id === conversation.from.id && bot.status === 'active');
        const recipient = bots.find((bot) => bot.id === conversation.to.id && bot.status === 'active');
        const actor = recipient ?? sender;
        const peer = actor?.id === conversation.from.id ? conversation.to : conversation.from;
        const query = new URLSearchParams({ bot: actor?.id ?? '', peer: peer.id });
        return (
          <Row
            key={`${conversation.id}-${conversation.from.id}-${conversation.to.id}`}
            name={`${conversation.from.name} → ${conversation.to.name}`}
            to={actor ? `/messages/${conversation.id}?${query}` : `/mail/${conversation.id}`}
            detail={conversation.preview || 'Attachment'}
            stamp={conversation.created_at}
            meta={conversation.unread ? `${conversation.unread} unread` : undefined}
          />
        );
      })}
      {state.data?.total === 0 && (
        <Empty
          title={bots.length ? 'No conversations yet' : 'No bots yet'}
          body={
            bots.length
              ? 'Messages involving any of your bots will appear here.'
              : 'Connect or create your first bot to start a conversation.'
          }
          action={!bots.length ? <Button to="/bots">Manage bots</Button> : undefined}
        />
      )}
      {state.data && state.data.total > 50 && (
        <div className="ws-tools home-pagination" aria-label="Conversation pages">
          <span className="muted">
            {offset + 1}–{Math.min(offset + 50, state.data.total)} of {state.data.total}
          </span>
          <div className="button-row">
            <Button
              tone="secondary"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 50))}
            >
              Previous
            </Button>
            <Button
              tone="secondary"
              disabled={offset + 50 >= state.data.total}
              onClick={() => setOffset(offset + 50)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </State>
  );
}
