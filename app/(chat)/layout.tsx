import { ChatRail } from '@/app/components/chat-rail';
import { ChatShell } from '@/app/components/chat-shell';

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return <ChatShell rail={<ChatRail />}>{children}</ChatShell>;
}
