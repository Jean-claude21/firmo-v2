import { createFileRoute } from "@tanstack/react-router";
import { Mail, MessageCircle, Send } from "lucide-react";
import type { ReactNode } from "react";
import { InfoPage } from "@/components/public-layout";
import { contact, phoneText } from "@/lib/contact";
import { useT } from "@/l10n";

// Contact (P-66) : seulement les canaux réellement configurés.
export const Route = createFileRoute("/contact")({ component: Contact });

function Block({ icon, title, value, href, text }: { icon: ReactNode; title: string; value?: string; href?: string; text: string }) {
  return (
    <section className="border-b border-line py-6">
      <h2 className="flex items-center gap-2 text-[20px] font-semibold">{icon}{title}</h2>
      {value && href && <p className="mt-2"><a href={href} target="_blank" rel="noreferrer" className="font-mono text-[18px] font-semibold underline underline-offset-4">{value}</a></p>}
      <p className="mt-2 text-[17px] leading-[27px] text-ink-soft">{text}</p>
    </section>
  );
}

function Contact() {
  const t = useT();
  const C = t.legal.contact;
  return (
    <InfoPage title={C.title} intro={C.intro}>
      <Block icon={<MessageCircle className="size-5" aria-hidden />} title={C.inChat} text={C.inChatText} />
      {contact.whatsapp && <Block icon={<MessageCircle className="size-5" aria-hidden />} title={C.useWhatsapp} value={phoneText(contact.whatsapp)} href={`https://wa.me/${contact.whatsapp}`} text={C.useWhatsappText} />}
      {contact.telegram && <Block icon={<Send className="size-5" aria-hidden />} title={C.useTelegram} value={`@${contact.telegram}`} href={`https://t.me/${contact.telegram}`} text={C.useTelegramText} />}
      {contact.supportWhatsapp && <Block icon={<MessageCircle className="size-5" aria-hidden />} title={C.support} value={phoneText(contact.supportWhatsapp)} href={`https://wa.me/${contact.supportWhatsapp}`} text={C.supportText} />}
      {contact.email && <Block icon={<Mail className="size-5" aria-hidden />} title={C.email} value={contact.email} href={`mailto:${contact.email}`} text={C.emailText} />}
      {contact.hours && <section className="py-6"><h2 className="text-[20px] font-semibold">{C.hours}</h2><p className="mt-2 whitespace-pre-line text-[17px] text-ink-soft">{contact.hours}</p></section>}
    </InfoPage>
  );
}
