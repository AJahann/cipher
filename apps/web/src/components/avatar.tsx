export type AvatarColor = 'blue' | 'teal' | 'coral' | 'purple' | 'green';

const avatarClasses: Record<AvatarColor, string> = {
  blue: 'bg-blue-100   text-blue-800',
  teal: 'bg-teal-100   text-teal-800',
  coral: 'bg-orange-100 text-orange-800',
  purple: 'bg-purple-100 text-purple-800',
  green: 'bg-green-100  text-green-800',
};

export function Avatar({
  initials,
  color,
  group = false,
  size = 'md',
}: {
  initials: string;
  color: AvatarColor;
  group?: boolean;
  size?: 'sm' | 'md';
}) {
  const sz = size === 'sm' ? 'w-6 h-6 text-[9px]' : 'w-10 h-10 text-[13px]';
  const rounded = group ? 'rounded-xl' : 'rounded-full';
  return (
    <div
      className={`${sz} ${rounded} ${avatarClasses[color]} flex items-center justify-center font-medium shrink-0`}
    >
      {initials}
    </div>
  );
}
