import { BrandMark } from './components/BrandMark';
import {
  Bell,
  Bot,
  ClipboardList,
  Hash,
  Heart,
  House,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  Moon,
  Network,
  Plus,
  ScrollText,
  Search,
  Send,
  Settings,
  ShieldCheck,
  SquarePen,
  Sun,
  UserRound,
  X,
} from 'lucide-react';

export function Avatar({ name, large = false }: { name: string; large?: boolean }) {
  const hue = Array.from(name).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 360, 0);
  return (
    <span
      style={{ backgroundColor: 'hsl(' + hue + ' 23% 23%)', color: '#fff' }}
      className={`bot-avatar${large ? ' large' : ''}`}
      aria-hidden="true"
    >
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
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
  Brand: BrandMark,
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
  'Sign out': LogOut,
  'Light theme': Sun,
  'Dark theme': Moon,
};

export type IconName = keyof typeof icons;

export function Icon({ name }: { name: IconName }) {
  const Glyph = icons[name];
  return <Glyph size={24} strokeWidth={1.75} aria-hidden="true" focusable="false" />;
}
