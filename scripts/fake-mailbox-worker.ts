import { WorkerEntrypoint } from "cloudflare:workers";
const flags = new Map<string, boolean>();
/** Fictional accounts only; never accepts, logs or forwards real credentials. */
export class FakeMailbox extends WorkerEntrypoint {
  async fetch(request: Request) {
    const a = (await request.json()) as {
      address: string;
      password: string;
      uid?: number;
      read?: boolean;
      part?: string;
      before?: number;
      validity?: string;
      path?: string;
    };
    if (
      !/^[a-z0-9]+@local-mail\.invalid$/.test(a.address) ||
      a.password !== "Local-Mailbox-Test-Only-1"
    )
      return new Response("Invalid fixture", { status: 403 });
    const action = new URL(request.url).pathname;
    if (action === "/verify") return Response.json({ ok: true });
    if (action === "/seen") {
      flags.set(`${a.address}:${a.uid}`, Boolean(a.read));
      return Response.json({ ok: true });
    }
    if (action === "/send") return Response.json({ status: "captured" });
    if(a.address.startsWith("bulk")&&(action==="/fetch"||action==="/page")){
      const end=action==="/fetch"?456:Math.min(456,(a.before||1)-1),start=Math.max(1,end-(action==="/fetch"?39:99));
      return Response.json({validity:"fixture-1",total:456,hasMore:start>1,messages:Array.from({length:Math.max(0,end-start+1)},(_,i)=>({uid:start+i,uidValidity:"fixture-1",sender:"fixture@example.invalid",recipient:a.address,subject:`Bulk message ${start+i}`,body:"",receivedAt:1792396800000+(start+i)*1000,isRead:false,truncated:false,headersOnly:true}))});
    }
    if(action==="/page")return Response.json({validity:a.validity,total:a.path==="INBOX"?108:7,hasMore:false,messages:[]});
    if (action === "/metadata") return Response.json(a.uid === 1 ? [{part:"2",contentId:"fixture-logo",name:"Fictional enquiry.png",type:"image/png",size:68},{part:"3",name:"Fictional specification.txt",type:"text/plain",size:300000}] : []);
    if (action === "/folders")
      return Response.json(
        (["sent", "drafts"] as const).map((kind, i) => ({
          kind,
          path: kind === "sent" ? "INBOX.Sent" : "INBOX.Drafts",
          total: i ? 2 : 7,
          validity: `folder-${kind}`,
          messages: Array.from({ length: i ? 2 : 7 }, (_, j) => ({
            uid: j + 1,
            uidValidity: `folder-${kind}`,
            sender: a.address,
            recipient: "buyer@example.invalid",
            subject: `Fictional ${kind} message ${j + 1}`,
            body: "",
            receivedAt: 1792396800000 - j * 1000,
            isRead: true,
            truncated: false,
          })),
        })),
      );
    if (a.address.startsWith("scroll") && action === "/fetch")
      return Response.json({
        validity: "fixture-1",
        total:140,
        messages: Array.from({ length: 40 }, (_, i) => ({
          uid: i + 1,
          uidValidity: "fixture-1",
          sender: "fixture@example.invalid",
          recipient: a.address,
          subject: `Scroll regression message ${i + 1}`,
          body: "Fictional long email preview",
          receivedAt: 1792396800000 - i * 1000,
          isRead: false,
          truncated: false,
        })),
      });
    if (action === "/detail")
      return Response.json({
        subject:a.uid===1?"Fictional SN500 quotation enquiry":a.uid===3?"See more of the conversions you're already driving":"Fictional office newsletter",
        sender:a.uid===1?"buyer@example.invalid":a.uid===3?"notification@facebookmail.com":"office@example.invalid",
        body: a.address.startsWith("scroll")
          ? "Fictional forwarded email\n\n" +
            Array.from(
              { length: 160 },
              (_, i) =>
                `Quoted correspondence line ${i + 1}: fictional content for scrolling.`,
            ).join("\n\n")
          : a.uid === 1
            ? "Company: Fictional Coastal Buyer\nContact: Sam Example\nProduct: SN500\nPlease quote 25 MT for our enquiry.\n\nThis full message loads even when the email contains large attachments."
            : a.uid===3?"Facebook conversions: Please quote 25 MT of SN500. This adversarial fixture must still be excluded as a platform notification.":"A fictional office notice for the team.",
        truncated: false,
        html: a.address.startsWith("scroll")
          ? undefined
          : '<style>.brand-card{max-width:640px;margin:auto;font-family:Arial,sans-serif;background:#fff;border:1px solid #e4e4e7}.brand-header{background:#132c42;color:#fff;padding:28px}.brand-content{padding:24px}.brand-content table{width:100%;border-collapse:collapse}.brand-content td,.brand-content th{text-align:left;border-bottom:1px solid #ddd;padding:10px}</style><div class="brand-card"><div class="brand-header"><img alt="Embedded brand logo" src="cid:fixture-logo" width="40" height="40"><h1 style="color:#fff;font-size:24px">Greetings from Fictional Company</h1></div><div style="height:8px;background:#e45b21"></div><div class="brand-content"><h2 style="font-size:22px;color:#132c42">New enquiry</h2><p>This full message loads even when the email contains large attachments.</p><table><thead><tr><th>Destination</th><th>Product</th></tr></thead><tbody><tr><td>Example Port</td><td>SN500</td></tr></tbody></table><p><a href="https://example.invalid/catalogue">View catalogue</a> · <a href="mailto:buyer@example.invalid">Email buyer</a><a href="javascript:alert(1)">Unsafe link</a></p><img alt="External brand image" src="//tracker.invalid/pixel"><img alt="Lazy remote image" data-src="https://tracker.invalid/lazy"><script>window.mailUnsafe=true;top.document.body.dataset.mailUnsafe="true"</script><p onclick="alert(1)">Please confirm your requirements.</p></div></div>',
        attachments:
          a.uid === 1
            ? [
                {
                  part: "2",
                  contentId: "fixture-logo",
                  name: "Fictional enquiry.png",
                  type: "image/png",
                  size: 68,
                },
                {
                  part: "3",
                  name: "Fictional specification.txt",
                  type: "text/plain",
                  size: 300000,
                },
              ]
            : [],
      });
    if (action === "/attachment") {
      if (!["2", "3"].includes(a.part || ""))
        return new Response("Not found", { status: 404 });
      return Response.json({
        base64:
          a.part === "2"
            ? "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1WQAAAAASUVORK5CYII="
            : btoa("Fictional test specification\n"),
        file: {
          part: a.part,
          name:
            a.part === "2"
              ? "Fictional enquiry.png"
              : "Fictional specification.txt",
          type: a.part === "2" ? "image/png" : "text/plain",
          size: 68,
        },
      });
    }
    if (action === "/fetch")
      return Response.json({
        validity: "fixture-1",
        total:108,
        messages: [
          {
            uid: 1,
            uidValidity: "fixture-1",
            sender: "buyer@example.invalid",
            recipient: a.address,
            subject: "Fictional SN500 quotation enquiry",
            body: "Company: Fictional Coastal Buyer\nContact: Sam Example\nProduct: SN500\nPlease quote 25 MT for our enquiry.",
            receivedAt: 1792396800000,
            isRead: flags.get(`${a.address}:1`) || false,
            truncated: false,
          },
          {
            uid: 2,
            uidValidity: "fixture-1",
            sender: "newsletter@example.invalid",
            recipient: a.address,
            subject: "Fictional office newsletter",
            body: "A fictional office notice for the team.",
            receivedAt: 1792396700000,
            isRead: false,
            truncated: false,
          },
          {uid:3,uidValidity:"fixture-1",sender:"notification@facebookmail.com",recipient:a.address,subject:"See more of the conversions you're already driving",body:"Facebook advertising pricing, purchase and sales conversions",receivedAt:1792396600000,isRead:false,truncated:false},
        ],
      });
    return new Response("Not found", { status: 404 });
  }
}
