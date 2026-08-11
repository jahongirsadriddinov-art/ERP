import nodemailer from 'nodemailer';

const EMAIL_HOST = process.env.EMAIL_HOST || 'smtp.gmail.com';
const EMAIL_PORT = parseInt(process.env.EMAIL_PORT || '587');
const EMAIL_USER = process.env.EMAIL_USER || '';
const EMAIL_PASS = process.env.EMAIL_PASS || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'QurilishERP <noreply@qurilisherp.uz>';

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (!EMAIL_USER || !EMAIL_PASS) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: EMAIL_HOST,
      port: EMAIL_PORT,
      secure: EMAIL_PORT === 465,
      auth: { user: EMAIL_USER, pass: EMAIL_PASS },
    });
  }
  return transporter;
}

export async function sendEmail(to: string, subject: string, html: string, text?: string): Promise<boolean> {
  const t = getTransporter();
  if (!t) return false;
  try {
    await t.sendMail({ from: EMAIL_FROM, to, subject, html, text: text || html.replace(/<[^>]+>/g, '') });
    return true;
  } catch (err) {
    console.error('[email] xatolik:', (err as Error).message);
    return false;
  }
}

export async function sendTransferNotification(toEmail: string, opts: {
  fromName: string; materialName: string; quantity: number; unit: string; projectName?: string;
}) {
  return sendEmail(toEmail, `QurilishERP: Yangi o'tkazma`,
    `<div style="font-family:sans-serif;max-width:480px;margin:auto">
      <h2 style="color:#1B3A6B">📦 Yangi material o'tkazmasi</h2>
      <p><b>${opts.fromName}</b> sizga material yubordi:</p>
      <ul>
        <li>Material: <b>${opts.materialName}</b></li>
        <li>Miqdor: <b>${opts.quantity} ${opts.unit}</b></li>
        ${opts.projectName ? `<li>Obyekt: <b>${opts.projectName}</b></li>` : ''}
      </ul>
      <p>Iltimos, QurilishERP saytiga kiring va tasdiqlaing.</p>
      <a href="${process.env.SITE_URL}" style="background:#1B3A6B;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">Saytga o'tish</a>
    </div>`
  );
}

export async function sendExpenseApprovalRequest(toEmail: string, opts: {
  fromName: string; amount: number; description: string; type: string;
}) {
  const amountFmt = opts.amount.toLocaleString('uz-UZ') + " so'm";
  return sendEmail(toEmail, `QurilishERP: Chiqim tasdiqlash so'rovi`,
    `<div style="font-family:sans-serif;max-width:480px;margin:auto">
      <h2 style="color:#D2440F">💰 Chiqim tasdiqlash so'rovi</h2>
      <p><b>${opts.fromName}</b> chiqim qo'shdi:</p>
      <ul>
        <li>Tur: <b>${opts.type}</b></li>
        <li>Tavsif: <b>${opts.description}</b></li>
        <li>Summa: <b>${amountFmt}</b></li>
      </ul>
      <a href="${process.env.SITE_URL}" style="background:#D2440F;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">Tasdiqlash</a>
    </div>`
  );
}

export async function sendWelcomeEmail(toEmail: string, name: string, companyName: string) {
  return sendEmail(toEmail, `QurilishERP ga xush kelibsiz — ${companyName}`,
    `<div style="font-family:sans-serif;max-width:480px;margin:auto">
      <h2 style="color:#1B3A6B">🏗️ Xush kelibsiz, ${name}!</h2>
      <p><b>${companyName}</b> qurilish boshqaruv tizimiga qo'shildingiz.</p>
      <p>QurilishERP orqali siz:</p>
      <ul>
        <li>Qurilish obyektlarini boshqarishingiz</li>
        <li>Material o'tkazmalarini kuzatishingiz</li>
        <li>Xodimlar bilan real vaqtda muloqot qilishingiz mumkin</li>
      </ul>
      <a href="${process.env.SITE_URL}" style="background:#1B3A6B;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">Tizimga kirish</a>
    </div>`
  );
}
