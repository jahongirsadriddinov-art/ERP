import { useState, type CSSProperties } from "react";
import { MorphIcon } from "morphicons/react";
import X from "@hugeicons/core-free-icons/Cancel01Icon";
import Loader2 from "@hugeicons/core-free-icons/Loading03Icon";
import { useTranslation } from "react-i18next";
import { API_BASE } from "./api";
import { AVATARS } from "./avatars/manifest";

// Owner 2026-11-12/13: "profilga tayyor memoji-uslubidagi avatar tanlash" so'ralgan.
// Haqiqiy Apple Memoji (yoki litsenziyasi noaniq "memoji-uslubidagi" GitHub paketlari,
// masalan Tapback/memojimaker — ularning o'zi README'da "grafika Apple'niki" deb yozgan)
// tijorat ilovasiga qo'shib bo'lmaydi (huquqiy xavf). Shuning uchun ilovada ALLAQACHON
// tasdiqlangan, litsenziyasi TO'LIQ aniq to'plam ishlatiladi: Microsoft Fluent Emoji 3D
// (MIT, github.com/microsoft/fluentui-emoji) — xuddi shu fayllar yangi foydalanuvchilarga
// avtomatik tayinlash uchun ham ishlatiladi (frontend/public/avatars/NOTICE.txt).
// Rasmlar backend'ning o'zidan xizmat qilinadi (/api/avatars/builtin/...) — profil avatar
// URL faqat Cloudinary yoki shu backend hostiga ruxsat etiladi (users.ts: isAllowedAvatarUrl).
function avatarUrl(file: string) {
  return `${API_BASE}/api/avatars/builtin/${file.replace(/^\/avatars\//, "")}`;
}

export default function AvatarPicker({ onClose, onSelect }: { onClose: () => void; onSelect: (url: string) => Promise<void> | void }) {
  const { t } = useTranslation();
  const [savingId, setSavingId] = useState<string | null>(null);

  const pick = async (id: string, file: string) => {
    if (savingId) return;
    setSavingId(id);
    try {
      await onSelect(avatarUrl(file));
      onClose();
    } finally { setSavingId(null); }
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-md max-h-[85vh] supports-[height:1dvh]:max-h-[85dvh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-border flex-shrink-0">
          <div>
            <h3 className="font-bold text-sm">{t('profile.avatarPicker.title', { defaultValue: 'Tayyor avatar tanlash' })}</h3>
            <p className="text-[11px] text-muted-foreground">{t('profile.avatarPicker.subtitle', { defaultValue: `${AVATARS.length} ta variantdan birini tanlang` })}</p>
          </div>
          <button aria-label={t('common.close', { defaultValue: 'Yopish' })} onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted liquid-transition flex-shrink-0">
            <MorphIcon icon={X} className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="p-3 overflow-y-auto grid grid-cols-5 gap-2.5">
          {AVATARS.map((a) => (
            <button key={a.id} onClick={() => pick(a.id, a.file)} disabled={!!savingId}
              className="relative aspect-square rounded-xl overflow-hidden bg-muted/40 hover:ring-2 hover:ring-primary liquid-transition disabled:opacity-50 flex items-center justify-center">
              <img src={avatarUrl(a.file)} alt="" loading="lazy"
                className={`memoji-avatar__img${a.fit ? " memoji-avatar__img--fit" : ""}`}
                style={a.fit ? { ["--av-zoom" as string]: a.fit.zoom, ["--av-y" as string]: `${a.fit.y}%` } as CSSProperties : undefined} />
              {savingId === a.id && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <MorphIcon icon={Loader2} className="w-5 h-5 text-white animate-spin" />
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
