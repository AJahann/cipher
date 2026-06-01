import { User } from '@chat-app/shared';

function ChatItem({ chat, onClick }: { chat: User; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className='w-full cursor-pointer flex items-center gap-2.5 px-5 py-6 bg-neutral-800 transition-colors text-left'
    >
      <div className='flex-1 min-w-0'>
        <p className='text-md font-medium text-gray-900 dark:text-gray-100 truncate'>
          {chat.username}
        </p>
      </div>
    </button>
  );
}

interface Props {
  chatList: User[];
  setActiveChatId: (id: string) => void;
}

const Sidebar = ({ chatList, setActiveChatId }: Props) => {
  return (
    <aside className='w-64 shrink-0 border-r border-gray-200 dark:border-neutral-700 flex flex-col'>
      <div className='flex-1 overflow-y-auto'>
        {chatList.map((c) => (
          <ChatItem key={c.id} chat={c} onClick={() => setActiveChatId(c.id)} />
        ))}
      </div>
    </aside>
  );
};

export default Sidebar;
