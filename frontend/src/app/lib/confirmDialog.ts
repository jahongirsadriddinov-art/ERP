// O'zimizning tasdiqlash oynasi (window.confirm o'rniga). Brauzerning confirm()'i Windows ilovasida (Tauri)
// umuman ishlamas edi ("dialog|confirm not allowed by ACL") va tasdiqsiz o'tib ketishi mumkin edi; Android'da ham
// xunuk tizim oynasi chiqardi. Bu oyna hamma joyda bir xil: shaffof fon, Esc — bekor, Enter — tasdiqlash.
export function confirmDialog(message: string, opts: { okText?: string; cancelText?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise(resolve => {
    const lang = (document.documentElement.lang || "").toLowerCase();
    const ru = lang.startsWith("ru");
    const okText = opts.okText || (ru ? "Да" : "Ha");
    const cancelText = opts.cancelText || (ru ? "Отмена" : "Bekor qilish");
    const dark = document.documentElement.classList.contains("dark");
    const wrap = document.createElement("div");
    wrap.setAttribute("role", "alertdialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.style.cssText = "position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.45);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);opacity:0;transition:opacity .15s ease";
    const card = document.createElement("div");
    card.style.cssText = `width:100%;max-width:380px;border-radius:22px;padding:20px;box-shadow:0 30px 70px -20px rgba(0,0,0,.6);border:1px solid ${dark ? "rgba(255,255,255,.12)" : "rgba(15,23,42,.12)"};background:${dark ? "rgba(22,24,32,.92)" : "rgba(255,255,255,.95)"};color:${dark ? "#f1f5f9" : "#0f172a"};font-family:inherit;transform:translateY(8px) scale(.98);transition:transform .18s ease`;
    const msg = document.createElement("p");
    msg.textContent = message;
    msg.style.cssText = "margin:0 0 18px;font-size:15px;line-height:1.5;font-weight:600;white-space:pre-wrap;word-break:break-word";
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px";
    const mk = (text: string, primary: boolean) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = text;
      const bg = primary ? (opts.danger ? "#dc2626" : "var(--primary, #2563eb)") : "transparent";
      b.style.cssText = `flex:1;height:44px;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;border:1px solid ${primary ? "transparent" : dark ? "rgba(255,255,255,.18)" : "rgba(15,23,42,.18)"};background:${bg};color:${primary ? "#fff" : "inherit"}`;
      return b;
    };
    const cancel = mk(cancelText, false), ok = mk(okText, true);
    row.append(cancel, ok);
    card.append(msg, row);
    wrap.append(card);
    const prevFocus = document.activeElement as HTMLElement | null;
    const close = (v: boolean) => {
      document.removeEventListener("keydown", onKey, true);
      wrap.style.opacity = "0";
      setTimeout(() => { wrap.remove(); prevFocus?.focus?.(); }, 150);
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(false); }
      else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); close(true); }
    };
    cancel.onclick = () => close(false);
    ok.onclick = () => close(true);
    wrap.onclick = e => { if (e.target === wrap) close(false); };
    document.addEventListener("keydown", onKey, true);
    document.body.append(wrap);
    requestAnimationFrame(() => { wrap.style.opacity = "1"; card.style.transform = "none"; ok.focus(); });
  });
}
