// Telegram uslubidagi dumaloq avatar: rasm yoki rangli bosh harflar, onlayn nuqta.
import { useEffect, useState } from "react";
import { MorphIcon } from "morphicons/react";
import Users2 from "@hugeicons/core-free-icons/UserGroup02Icon";
import { avatarColor, initials } from "./chatModel";

export function ChatAvatar({ name, src, seed, size = 48, online, group, support }: {
  name: string; src?: string; seed: string; size?: number; online?: boolean; group?: boolean; support?: boolean;
}) {
  const [bad, setBad] = useState(false);
  useEffect(() => { setBad(false); }, [src]);
  const dot = Math.max(10, Math.round(size * 0.27));
  return (
    <span className="relative flex-shrink-0 inline-block" style={{ width: size, height: size }}>
      {src && !bad ? (
        <img src={src} alt="" className="w-full h-full rounded-full object-cover" onError={() => setBad(true)} draggable={false} />
      ) : support ? (
        <span className="w-full h-full rounded-full flex items-center justify-center bg-orange-500/15" style={{ fontSize: size * 0.45 }}>🛠</span>
      ) : (
        <span className="w-full h-full rounded-full flex items-center justify-center text-white font-semibold select-none"
          style={{ background: `linear-gradient(160deg, ${avatarColor(seed)}, ${avatarColor(seed)}cc)`, fontSize: Math.round(size * 0.36) }}>
          {group ? <MorphIcon icon={Users2} className="w-[45%] h-[45%]" /> : initials(name)}
        </span>
      )}
      {online && (
        <span data-testid="chat-online-dot" className="absolute bottom-0 right-0 rounded-full bg-green-500 border-2 border-card" style={{ width: dot, height: dot }} />
      )}
    </span>
  );
}
