import { createFileRoute } from "@tanstack/react-router";
import { Camera, FileText, Loader2, Mic, Plus, SendHorizontal, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Mark } from "@/components/brand";
import { Button, Input, PageTitle } from "@/components/ui";
import { api, authedBlobUrl } from "@/lib/api";
import { useT } from "@/l10n";

// Simulateur (ADM-6) : le même moteur que WhatsApp et Telegram, dans le navigateur.
export const Route = createFileRoute("/admin/simulateur")({ component: Simulator });

interface SimMessage {
  id: string;
  direction: "in" | "out";
  kind: string;
  text: string | null;
  transcript: string | null;
  mediaKey: string | null;
  mediaType: string | null;
  buttons: Array<{ id: string; title: string }>;
}

const KEY = "firmo.simulator.conversation";

function newConversation(): string {
  return `sim-${Math.random().toString(36).slice(2, 10)}`;
}

function Media({ k, type, label }: { k: string; type: string | null; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    authedBlobUrl("staff", `/v1/simulator/media?key=${encodeURIComponent(k)}`).then((x) => { u = x; setUrl(x); }).catch(() => undefined);
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [k]);
  if (!url) return <div className="skeleton h-40 w-56" />;
  if (type?.startsWith("image/")) return <img src={url} alt="" className="max-h-80 rounded-lg" />;
  if (type?.startsWith("audio/")) return <audio controls src={url} className="max-w-full" />;
  return <a href={url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 font-medium underline"><FileText className="size-4" />{label}</a>;
}

function Simulator() {
  const t = useT();
  const S = t.admin.sim;
  const [conversation, setConversation] = useState<string>("");
  const [phone, setPhone] = useState("+22890000000");
  const [text, setText] = useState("");
  const [items, setItems] = useState<SimMessage[]>([]);
  const [waiting, setWaiting] = useState(false);
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let c = "";
    try { c = localStorage.getItem(KEY) ?? ""; } catch { /* navigation privée */ }
    if (!c) c = newConversation();
    setConversation(c);
  }, []);

  const load = useCallback(async () => {
    if (!conversation) return;
    const r = await api<{ items: SimMessage[] }>("staff", `/v1/simulator/conversations/${conversation}/messages`).catch(() => null);
    if (r) setItems(r.items);
    return r?.items ?? [];
  }, [conversation]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [items.length]);

  // Après un envoi : on interroge jusqu'à la réponse (et la remise du PDF).
  useEffect(() => {
    if (!waiting) return;
    let n = 0;
    const timer = setInterval(async () => {
      n++;
      const list = (await load()) ?? [];
      const last = list[list.length - 1];
      if ((last?.direction === "out" && n > 3) || n > 40) setWaiting(false);
    }, 1500);
    return () => clearInterval(timer);
  }, [waiting, load]);

  async function send(body: { text?: string; media?: { base64: string; mediaType: string } }) {
    try { localStorage.setItem(KEY, conversation); } catch { /* rien */ }
    await api("staff", "/v1/simulator/messages", { body: { conversation, phone, name: "Simulateur", ...body } });
    setWaiting(true);
    void load();
  }

  async function fileToBase64(blob: Blob): Promise<string> {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  }

  async function toggleVoice() {
    if (recorder) {
      recorder.stop();
      setRecorder(null);
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((tr) => tr.stop());
      const blob = new Blob(chunks, { type: rec.mimeType.split(";")[0] || "audio/webm" });
      await send({ media: { base64: await fileToBase64(blob), mediaType: blob.type } });
    };
    rec.start();
    setRecorder(rec);
  }

  return (
    <div className="px-5 py-6 lg:px-7">
      <PageTitle title={t.admin.nav.simulator} subtitle={S.intro} />
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="block w-48">
          <span className="label">{S.phone}</span>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <Button variant="outline" icon={<Plus className="size-4" />} onClick={() => { const c = newConversation(); setConversation(c); setItems([]); try { localStorage.setItem(KEY, c); } catch { /* rien */ } }}>{S.newConversation}</Button>
        <span className="text-sm text-muted">{S.conversation} : {conversation}</span>
      </div>

      <div className="mx-auto flex h-[70vh] max-w-xl flex-col overflow-hidden rounded-[24px] border border-line bg-[#ECE5DD] shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-2 bg-ink px-4 py-3 text-white"><Mark className="size-7" /><span className="font-semibold">Firmo</span></div>
        <div className="flex-1 space-y-2 overflow-y-auto p-3 text-[14px]">
          {items.length === 0 && <p className="mt-10 text-center text-muted">{S.empty}</p>}
          {items.map((m) => (
            <div key={m.id} className={`flex ${m.direction === "in" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 shadow-sm ${m.direction === "in" ? "rounded-tr-sm bg-[#DCF8C6]" : "rounded-tl-sm bg-white"}`}>
                {m.mediaKey && <Media k={m.mediaKey} type={m.mediaType} label={m.text ?? S.openPdf} />}
                {m.text && !(m.mediaKey && m.mediaType === "application/pdf") && <p className="whitespace-pre-line">{m.text}</p>}
                {m.transcript && <p className="mt-1 text-xs italic text-muted">« {m.transcript} »</p>}
                {m.buttons.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5 border-t border-line pt-2">
                    {m.buttons.map((b) => (
                      <button key={b.id} onClick={() => send({ text: b.id })} className="min-h-9 rounded-full bg-paper px-3 text-sm font-medium text-info hover:bg-info-soft">{b.title}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {waiting && <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" />{S.processing}</p>}
          <div ref={bottom} />
        </div>
        <form className="flex items-center gap-2 border-t border-line bg-surface p-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { void send({ text: text.trim() }); setText(""); } }}>
          <label className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-paper" aria-label={S.photo}>
            <Camera className="size-5" />
            <input type="file" accept="image/*" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) await send({ media: { base64: await fileToBase64(f), mediaType: f.type || "image/jpeg" } }); e.target.value = ""; }} />
          </label>
          <input className="field flex-1 rounded-full" placeholder={recorder ? S.recording : S.placeholder} value={text} onChange={(e) => setText(e.target.value)} disabled={Boolean(recorder)} />
          {text.trim() ? (
            <button type="submit" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-ink text-white" aria-label={S.send}><SendHorizontal className="size-5" /></button>
          ) : (
            <button type="button" onClick={toggleVoice} className={`flex size-11 shrink-0 items-center justify-center rounded-full ${recorder ? "bg-danger text-white" : "bg-ink text-white"}`} aria-label={S.voice}>
              {recorder ? <Square className="size-4" /> : <Mic className="size-5" />}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
