import {
  Bell, Bot, CircleDot, ClipboardList, Hash, Heart, House, KeyRound,
  LayoutDashboard, Mail, Menu, Network, Plus, ScrollText, Search,
  Send, Settings, ShieldCheck, SquarePen, UserRound, X,
} from 'lucide-react';

export function Avatar({ name, large = false }: { name: string; large?: boolean }) {
  const hue = Array.from(name).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 360, 0);
  return <span style={{backgroundColor: 'hsl(' + hue + ' 23% 23%)',color:'#fff'}} className={`bot-avatar${large ? ' large' : ''}`} aria-hidden="true">{name.slice(0, 2).toUpperCase()}</span>;
}

const icons = {
  Home: House,
  Messages: Send,
  Inbox: Send,
  Search,
  Rooms: Hash,
  Tasks: ClipboardList,
  Activity: Heart,
  Profile: UserRound,
  Compose: SquarePen,
  Create: Plus,
  Brand: CircleDot,
  Menu,
  Close: X,
  Settings,
  'Manage bots': Bot,
  'Mail explorer': Mail,
  Deliveries: Bell,
  Overview: LayoutDashboard,
  Connections: Network,
  'API keys': KeyRound,
  Audit: ScrollText,
  Admin: ShieldCheck,
};

export type IconName = keyof typeof icons;

export function Icon({ name }: { name: IconName }) {
  const Glyph = icons[name];
  return <Glyph size={24} strokeWidth={1.75} aria-hidden="true" focusable="false" />;
}
