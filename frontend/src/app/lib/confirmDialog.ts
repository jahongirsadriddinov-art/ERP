// O'zimizning tasdiqlash oynasi (window.confirm o'rniga). Brauzerning confirm()'i Windows ilovasida (Tauri)
// umuman ishlamas edi ("dialog|confirm not allowed by ACL") va tasdiqsiz o'tib ketishi mumkin edi; Android'da ham
// xunuk tizim oynasi chiqardi. Bu oyna hamma joyda bir xil: shaffof fon, Esc — bekor, Enter — tasdiqlash.
type DialogOpts = { okText?: string; cancelText?: string; danger?: boolean };

export function confirmDialog(message: string, opts: DialogOpts = {}): Promise<boolean> {
  return openDialog(message, opts, false).then((v) => v !== null);
}

/** window.prompt o'rniga (owner 2026-10-23: Windows ilovasida brauzer dialoglari ishlamaydi). Bekor — null. */
export function promptDialog(message: string, opts: DialogOpts = {}): Promise<string | null> {
  return openDialog(message, opts, true);
}

function openDialog(message: string, opts: DialogOpts, withInput: boolean): Promise<string | null> {
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
    card.style.cssText = `width:100%;max-width:380px;border-radius:22px;padding:20px;box-shadow:0 30px 70px -20px rgba(0,0,0,.6);border:1px solid ${dark ? "rgba(255,255,255,.12)" : "rgba(15,23,42,.12)"};background:${dark ? "#16181f" : "#ffffff"};color:${dark ? "#f1f5f9" : "#0f172a"};font-family:inherit;transform:translateY(8px) scale(.98);transition:transform .18s ease`;
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
    let input: HTMLInputElement | null = null;
    if (withInput) {
      input = document.createElement("input");
      input.type = "text";
      input.autocomplete = "off";
      input.style.cssText = `width:100%;height:44px;margin:-6px 0 16px;padding:0 12px;border-radius:12px;font-size:16px;font-weight:600;outline:none;border:1px solid ${dark ? "rgba(255,255,255,.18)" : "rgba(15,23,42,.18)"};background:${dark ? "#0f1117" : "#f8fafc"};color:inherit`;
      card.append(msg, input, row);
    } else card.append(msg, row);
    wrap.append(card);
    const prevFocus = document.activeElement as HTMLElement | null;
    const close = (v: boolean) => {
      document.removeEventListener("keydown", onKey, true);
      wrap.style.opacity = "0";
      setTimeout(() => { wrap.remove(); prevFocus?.focus?.(); }, 150);
      resolve(v ? (input ? input.value : "") : null);
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
    requestAnimationFrame(() => { wrap.style.opacity = "1"; card.style.transform = "none"; (input || ok).focus(); });
  });
}
