"use client";
import { useState } from "react";
import { MessageCircle, ShieldCheck, ArrowUpRight, Send, Smartphone } from "lucide-react";
import { Button, Dialog, DialogActions, Field, Textarea } from "./ui/controls";
import { PageHeader } from "./ui/layout";

const channels = [
  { name: "WhatsApp Business", description: "Customer conversations through the WhatsApp Business Platform.", needs: "A business account, registered phone number, approved permissions and a verified webhook.", url: "https://developers.facebook.com/docs/whatsapp/", sample: "Can you share pricing for 200 MT of SN 500?" },
  { name: "Facebook Messenger", description: "Messages sent to your business Page.", needs: "A Facebook Page, Meta app, Page messaging permissions and webhook verification.", url: "https://developers.facebook.com/docs/messenger-platform/", sample: "We would like to discuss a supply agreement." },
  { name: "Instagram", description: "Direct messages for your professional account.", needs: "A professional Instagram account and approved messaging access for the chosen login method.", url: "https://developers.facebook.com/docs/instagram-platform/", sample: "Do you export lubricants to Kenya?" },
  { name: "LinkedIn", description: "Business presence and supported partner integrations.", needs: "Eligible API access must be confirmed. General personal inbox synchronisation is not promised; Page messaging requires a supported partner integration.", url: "https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access", sample: "I represent a distributor interested in your products." },
];
export default function SocialChannels({ sandbox }: { sandbox: boolean }) {
  const [active, setActive] = useState<(typeof channels)[number] | null>(null);
  const [demo, setDemo] = useState(false);
  const [reply, setReply] = useState("");
  const [captured, setCaptured] = useState<{ text: string; time: string }[]>([]);
  function openChannel(channel: (typeof channels)[number], preview = false) {
    setActive(channel); setDemo(preview); setReply(""); setCaptured([]);
  }
  return <section className="social-workspace"><PageHeader title="Social channels" description="One workspace for customer conversations. Connect each channel separately."/>
    <div className="mail-status"><ShieldCheck size={18}/><span>No social accounts connected. No posts or messages can be published.</span></div>
    <div className="social-grid">{channels.map(c => <article key={c.name} className="social-card"><div className="social-card-top"><MessageCircle size={22}/><span>Not connected</span></div><h2>{c.name}</h2><p>{c.description}</p><div className="social-card-actions"><Button className="secondary" onClick={() => openChannel(c)}>View setup</Button>{sandbox && <Button className="secondary" onClick={() => openChannel(c, true)}>Try conversation</Button>}</div></article>)}</div>
    <p className="social-footnote">Business-channel permissions are separate from private email access. Account selection, team access and provider approval must be configured before activation.</p>
    {active && <Dialog title={demo ? `${active.name} · local demo` : `Set up ${active.name}`} description={demo ? "Fictional conversation · no provider connection" : "Connection requirements"} onClose={() => setActive(null)} className="mail-compose">
      {demo ? <div className="social-demo"><p className="mail-status">Temporary demo only. Replies disappear when you close this dialog.</p><div className="social-contact"><span className="social-contact-avatar">SC</span><div><strong>Sample customer</strong><small>{active.name} · fictional conversation</small></div><ShieldCheck size={18}/></div><div className="social-transcript" role="log" aria-label="Test conversation"><div className="social-day">Local preview · nothing is sent</div><div className="social-bubble"><strong>Sample customer</strong><p>{active.sample}</p><small>Example incoming message</small></div>{captured.map((v,i) => <div className="social-bubble is-own" key={i}><strong>You</strong><p>{v.text}</p><small>{v.time} · Captured locally, not delivered</small></div>)}</div><Field>Reply<Textarea rows={3} placeholder="Write a test reply…" value={reply} maxLength={2000} onChange={e => setReply(e.target.value)}/></Field><DialogActions cancel="Close demo" primary={{label:"Capture test reply",disabled:!reply.trim(),onClick:() => { setCaptured(v => [...v,{text:reply.trim(),time:new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}]); setReply(""); }}}/></div> : <div className="social-setup"><div className="social-setup-intro"><Smartphone size={24}/><div><h2>Prepare your account</h2><p>{active.needs}</p></div></div><ol className="social-setup-steps"><li><strong>Confirm the business account</strong><span>Choose the account you own and the team members who should have access.</span></li><li><strong>Complete provider approval</strong><span>{active.name === "WhatsApp Business" ? "Phone verification belongs in the official provider setup. This CRM cannot request or validate an OTP yet. Never paste a verification code into chat." : "Use the provider’s official approval process. No account is connected from this screen."}</span></li><li><strong>Connect and verify delivery</strong><span>Live integration is still pending. Receiving, sending and access checks must pass before activation.</span></li></ol><p className="mail-status"><Send size={18}/>You can test the layout locally now. Live messaging is not enabled.</p><a href={active.url} target="_blank" rel="noreferrer">Official integration requirements <ArrowUpRight size={14}/></a><DialogActions secondary={sandbox ? <Button className="secondary" onClick={() => setDemo(true)}>Try local conversation</Button> : undefined}/></div>}
    </Dialog>}
  </section>;
}
