// Tarmoq sozlamasi — index.ts'da ENG BIRINCHI import qilinadi (bot va boshqa modullar import paytidayoq tashqi
// so'rov yuboradi). Render'da IPv6 chiqish yo'q: Node avval IPv6 manzilni sinab, ikkala urinish ham muvaffaqiyatsiz
// tugaganda "EFATAL: AggregateError" berardi (deploy paytida bot webhook/komandalarini o'rnata olmagan).
// IPv4'ni birinchi sinash shu xatoning oldini oladi.
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');
