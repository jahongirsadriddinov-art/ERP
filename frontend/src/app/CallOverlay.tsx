import { useState, useRef, useEffect } from "react";
import { Phone, PhoneOff, Mic, MicOff, Video as VideoIcon, VideoOff, Users2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { getSocket } from "./socket";
import { AppUser, ActiveCall } from "./App";

// Qo'ng'iroq oynasi (WebRTC) — kamdan-kam ishlatiladi (faqat qo'ng'iroq
// paytida), shuning uchun alohida faylga chiqarilib React.lazy orqali
// faqat chindan ham qo'ng'iroq boshlanganda yuklanadi.
// STUN'dan tashqari TURN ham kerak — STUN faqat ikkala tomon ham to'g'ridan-to'g'ri
// ulanadigan (oddiy NAT) tarmoqda ishlaydi. Ikki tomon turli tarmoqlarda bo'lsa
// (mobil internet vs Wi-Fi, ofis firewall va h.k. — real foydalanishda odatiy hol)
// ICE ulanmay qoladi va na ovoz, na video hech qachon kelmaydi ("ulanmoqda..."da
// abadiy qolib ketadi). Open Relay Project'ning bepul TURN serveri shu holatlarda
// P2P o'rniga trafikni relay qiladi.
const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ],
};

export default function CallOverlay({ currentUser, users, call, onClose }:
  { currentUser: AppUser; users: AppUser[]; call: ActiveCall; onClose: () => void }) {
  const { t } = useTranslation();
  const socket = getSocket();
  const localRef = useRef<HTMLVideoElement>(null);
  const localStream = useRef<MediaStream | null>(null);
  // streamReady — accept() bu promise'ni kutib stream tayyor bo'lganini bildiradi
  const streamReadyResolve = useRef<((s: MediaStream) => void) | null>(null);
  const streamReady = useRef<Promise<MediaStream>>(new Promise(res => { streamReadyResolve.current = res; }));
  const pcs = useRef<Record<string, RTCPeerConnection>>({});
  const pendingIce = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const [remote, setRemote] = useState<Record<string, MediaStream>>({});
  const [status, setStatus] = useState<'incoming'|'ringing'|'connected'>(call.direction === 'in' ? 'incoming' : 'ringing');
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(call.mode === 'voice');

  const userById = (id: string) => users.find(u => u.id === id);
  const title = call.groupId ? t('call.groupCall') : (userById(call.peerId || '')?.name || call.fromName || t('call.defaultTitle'));

  const makePC = (peerId: string) => {
    if (pcs.current[peerId]) return pcs.current[peerId];
    const pc = new RTCPeerConnection(ICE_CONFIG);
    localStream.current?.getTracks().forEach(t => pc.addTrack(t, localStream.current!));
    pc.onicecandidate = e => { if (e.candidate) socket?.emit('call:ice', { to: peerId, from: currentUser.id, candidate: e.candidate }); };
    pc.ontrack = e => { setRemote(prev => ({ ...prev, [peerId]: e.streams[0] })); setStatus('connected'); };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') toast.error(t('call.connectionError'));
    };
    pcs.current[peerId] = pc;
    return pc;
  };

  const offerTo = async (peerId: string) => {
    const pc = makePC(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket?.emit('call:offer', { to: peerId, from: currentUser.id, fromName: currentUser.name, mode: call.mode, groupId: call.groupId, sdp: offer });
  };

  const flushIce = async (peerId: string) => {
    const pc = pcs.current[peerId]; const list = pendingIce.current[peerId];
    if (pc && list) { for (const c of list) { try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {} } pendingIce.current[peerId] = []; }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: call.mode === 'video' });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        localStream.current = stream;
        if (localRef.current) { localRef.current.srcObject = stream; localRef.current.play().catch(()=>{}); }
        // Re-add tracks to any peer connections created before stream was ready (race condition fix)
        Object.values(pcs.current).forEach(pc => {
          stream.getTracks().forEach(t => { try { pc.addTrack(t, stream); } catch {} });
        });
        // accept() shu promise'ni kutib turib stream tayyor bo'lgandan keyin createAnswer qiladi
        streamReadyResolve.current?.(stream);
      } catch (e: any) { toast(t('call.permissionRequired', { message: e?.message || '' })); onClose(); return; }
      if (call.direction === 'out') {
        const targets = call.groupId ? (call.memberIds || []) : (call.peerId ? [call.peerId] : []);
        targets.forEach(t => offerTo(t));
      }
    })();

    const onAnswer = async (d: any) => { const pc = pcs.current[d.from]; if (pc) { await pc.setRemoteDescription(new RTCSessionDescription(d.sdp)); await flushIce(d.from); setStatus('connected'); } };
    const onIce = async (d: any) => {
      const pc = pcs.current[d.from];
      if (pc && pc.remoteDescription) { try { await pc.addIceCandidate(new RTCIceCandidate(d.candidate)); } catch {} }
      else { (pendingIce.current[d.from] ||= []).push(d.candidate); }
    };
    const onOffer = async (d: any) => { // guruh mesh — boshqa a'zodan yangi offer
      if (!call.groupId || d.groupId !== call.groupId || d.from === currentUser.id) return;
      const pc = makePC(d.from);
      await pc.setRemoteDescription(new RTCSessionDescription(d.sdp));
      await flushIce(d.from);
      const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
      socket?.emit('call:answer', { to: d.from, from: currentUser.id, sdp: ans });
    };
    const onJoin = (d: any) => { if (call.groupId && d.groupId === call.groupId && d.from !== currentUser.id) offerTo(d.from); };
    const closePeer = (peerId: string) => { pcs.current[peerId]?.close(); delete pcs.current[peerId]; setRemote(prev => { const c = { ...prev }; delete c[peerId]; return c; }); };
    const onEnd = (d: any) => { closePeer(d.from); if (Object.keys(pcs.current).length === 0) onClose(); };
    const onReject = (d: any) => { toast(t('call.declined')); onEnd(d); };

    socket?.on('call:answer', onAnswer);
    socket?.on('call:ice', onIce);
    socket?.on('call:offer', onOffer);
    socket?.on('call:join', onJoin);
    socket?.on('call:end', onEnd);
    socket?.on('call:reject', onReject);

    return () => {
      cancelled = true;
      socket?.off('call:answer', onAnswer); socket?.off('call:ice', onIce); socket?.off('call:offer', onOffer);
      socket?.off('call:join', onJoin); socket?.off('call:end', onEnd); socket?.off('call:reject', onReject);
      Object.values(pcs.current).forEach(pc => pc.close()); pcs.current = {};
      localStream.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  const accept = async () => {
    setStatus('ringing');
    // Stream tayyor bo'lishini kutamiz (agar hali kamera/mikrofon ruxsati olinmagan bo'lsa)
    await streamReady.current;
    const from = call.peerId!;
    const pc = makePC(from);
    await pc.setRemoteDescription(new RTCSessionDescription(call.offer));
    await flushIce(from);
    const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
    socket?.emit('call:answer', { to: from, from: currentUser.id, sdp: ans });
    if (call.groupId) socket?.emit('call:join', { groupId: call.groupId, from: currentUser.id });
  };
  const decline = () => { socket?.emit('call:reject', { to: call.peerId, from: currentUser.id }); onClose(); };
  const hangup = () => { Object.keys(pcs.current).forEach(pid => socket?.emit('call:end', { to: pid, from: currentUser.id })); onClose(); };
  const toggleMute = () => { const m = !muted; localStream.current?.getAudioTracks().forEach(t => t.enabled = !m); setMuted(m); };
  const toggleCam = () => { const c = !camOff; localStream.current?.getVideoTracks().forEach(t => t.enabled = !c); setCamOff(c); };

  const remoteEntries = Object.entries(remote);

  return (
    <div className="fixed inset-0 z-[100] bg-[#0A0E1C] flex flex-col animate-fade-in">
      {/* Video/masofaviy */}
      <div className="flex-1 relative overflow-hidden">
        {call.mode === 'video' && remoteEntries.length > 0 ? (
          <div className={`w-full h-full grid gap-1 ${remoteEntries.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {remoteEntries.map(([pid, stream]) => (
              <RemoteVideo key={pid} stream={stream} label={userById(pid)?.name || ''}/>
            ))}
          </div>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-white">
            <div className="w-28 h-28 rounded-full bg-white/10 flex items-center justify-center">
              {call.groupId ? <Users2 className="w-12 h-12"/> : <span className="text-4xl font-bold">{title.charAt(0)}</span>}
            </div>
            <p className="text-xl font-semibold">{title}</p>
            <p className="text-white/60 text-sm">
              {status === 'incoming' ? t('call.incoming', { type: call.mode === 'video' ? t('call.typeVideo') : t('call.typeVoice') }) :
               status === 'ringing' ? t('call.connecting') : t('call.connected')}
            </p>
            {/* Ovozli qo'ng'iroqda masofaviy audio */}
            {remoteEntries.map(([pid, stream]) => <RemoteAudio key={pid} stream={stream}/>)}
          </div>
        )}
        {/* Lokal PiP (mirror + larger for readability) */}
        {call.mode === 'video' && (
          <video ref={localRef} autoPlay muted playsInline
            className="absolute bottom-4 right-4 w-32 h-48 object-cover rounded-2xl border-2 border-white/30 shadow-xl bg-black"
            style={{ transform: 'scaleX(-1)' }}
          />
        )}
      </div>

      {/* Boshqaruv */}
      <div className="flex-shrink-0 pt-4 flex items-center justify-center gap-4" style={{ paddingBottom: "max(2rem, calc(env(safe-area-inset-bottom) + 1rem))" }}>
        {status === 'incoming' ? (
          <>
            <button onClick={decline} aria-label={t('call.decline')} className="w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center active:scale-95 shadow-lg"><PhoneOff className="w-6 h-6"/></button>
            <button onClick={accept} aria-label={t('call.accept')} className="w-16 h-16 rounded-full bg-green-500 text-white flex items-center justify-center active:scale-95 shadow-lg animate-pulse"><Phone className="w-6 h-6"/></button>
          </>
        ) : (
          <>
            <button onClick={toggleMute} aria-label={muted ? t('call.unmute') : t('call.mute')} className={`w-14 h-14 rounded-full flex items-center justify-center text-white active:scale-95 ${muted?'bg-white/30':'bg-white/10'}`}>{muted?<MicOff className="w-5 h-5"/>:<Mic className="w-5 h-5"/>}</button>
            {call.mode === 'video' && <button onClick={toggleCam} aria-label={camOff ? t('call.cameraOn') : t('call.cameraOff')} className={`w-14 h-14 rounded-full flex items-center justify-center text-white active:scale-95 ${camOff?'bg-white/30':'bg-white/10'}`}>{camOff?<VideoOff className="w-5 h-5"/>:<VideoIcon className="w-5 h-5"/>}</button>}
            <button onClick={hangup} aria-label={t('call.hangup')} className="w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center active:scale-95 shadow-lg"><PhoneOff className="w-6 h-6"/></button>
          </>
        )}
      </div>
    </div>
  );
}

function RemoteVideo({ stream, label }: { stream: MediaStream; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  // `autoPlay` attributi yolg'iz o'zi yetarli emas — bu element muted EMAS
  // (masofaviy ovoz shu orqali eshitiladi), va ba'zi brauzerlar (ayniqsa mobil)
  // muted bo'lmagan avtomatik play'ni jim tarzda bloklaydi: srcObject to'g'ri
  // o'rnatiladi, lekin ekran qop-qora bo'lib qoladi. Shuning uchun play()'ni
  // qo'lda ham chaqiramiz — xuddi lokal PiP videosida qilingani kabi.
  useEffect(() => { if (ref.current) { ref.current.srcObject = stream; ref.current.play().catch(()=>{}); } }, [stream]);
  return (
    <div className="relative w-full h-full bg-black">
      <video ref={ref} autoPlay playsInline className="w-full h-full object-cover"/>
      {label && <span className="absolute bottom-2 left-2 text-white text-xs bg-black/50 px-2 py-0.5 rounded">{label}</span>}
    </div>
  );
}
function RemoteAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => { if (ref.current) { ref.current.srcObject = stream; ref.current.play().catch(()=>{}); } }, [stream]);
  return <audio ref={ref} autoPlay/>;
}
