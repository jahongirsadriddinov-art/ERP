import { useState } from "react";
import { MorphIcon } from "morphicons/react";
import X from "@hugeicons/core-free-icons/Cancel01Icon";
import Loader2 from "@hugeicons/core-free-icons/Loading03Icon";
import { useTranslation } from "react-i18next";
import { API_BASE } from "./api";

// Owner 2026-11-12: "profilga tayyor memoji-uslubidagi avatar tanlash" so'ralgan.
// Haqiqiy Apple Memoji'ni (yoki litsenziyasi noaniq "memoji-uslubidagi" paketlarni)
// tijorat ilovasiga qo'shib bo'lmaydi (huquqiy xavf) — shuning uchun DiceBear
// "Avataaars" (MIT litsenziya, butunlay bepul, cheklovsiz) ishlatiladi. Rasmlar
// backend/src/routes/avatars.ts orqali, seed'dan deterministik generatsiya
// qilinadi (tashqi API chaqiruvi yo'q, pulllik emas).
const AVATAR_COUNT = 100;
const SEEDS = Array.from({ length: AVATAR_COUNT }, (_, i) => `erp-avatar-${i + 1}`);

function avatarUrl(seed: string) {
  return `${API_BASE}/api/avatars/dicebear/${seed}.svg`;
}

export default function AvatarPicker({ onClose, onSelect }: { onClose: () => void; onSelect: (url: string) => Promise<void> | void }) {
  const { t } = useTranslation();
  const [savingSeed, setSavingSeed] = useState<string | null>(null);

  const pick = async (seed: string) => {
    if (savingSeed) return;
    setSavingSeed(seed);
    try {
      await onSelect(avatarUrl(seed));
      onClose();
    } finally { setSavingSeed(null); }
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-md max-h-[85vh] supports-[height:1dvh]:max-h-[85dvh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-border flex-shrink-0">
          <div>
            <h3 className="font-bold text-sm">{t('profile.avatarPicker.title', { defaultValue: 'Tayyor avatar tanlash' })}</h3>
            <p className="text-[11px] text-muted-foreground">{t('profile.avatarPicker.subtitle', { defaultValue: `${AVATAR_COUNT} ta variantdan birini tanlang` })}</p>
          </div>
          <button aria-label={t('common.close', { defaultValue: 'Yopish' })} onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted liquid-transition flex-shrink-0">
            <MorphIcon icon={X} className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="p-3 overflow-y-auto grid grid-cols-5 gap-2.5">
          {SEEDS.map((seed) => (
            <button key={seed} onClick={() => pick(seed)} disabled={!!savingSeed}
              className="relative aspect-square rounded-xl overflow-hidden bg-muted/40 hover:ring-2 hover:ring-primary liquid-transition disabled:opacity-50">
              <img src={avatarUrl(seed)} alt="" loading="lazy" className="w-full h-full object-cover" />
              {savingSeed === seed && (
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
