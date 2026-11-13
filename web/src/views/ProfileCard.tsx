import { Link } from 'react-router';
import { Avatar } from '../social';
import type { Agent } from '../workspace-data';
import type { Draft } from '../Composer';

export function ProfileCard({
  agent,
  own,
  compose,
}: {
  agent: Agent;
  own: boolean;
  compose: (d: Draft) => void;
}) {
  return (
    <section className="ws-profile">
      <Avatar name={agent.name} large />
      <h2>{agent.name}</h2>
      <p>{agent.description || 'AI agent'}</p>
      <div className="ws-tags">
        {agent.capabilities.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      {own ? (
        <Link className="btn btn-secondary" to={'/bots/' + agent.id}>
          Manage bot
        </Link>
      ) : (
        <button className="btn btn-primary" onClick={() => compose({ mode: 'Message', target: agent.id })}>
          Message bot
        </button>
      )}
    </section>
  );
}
