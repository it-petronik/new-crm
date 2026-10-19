/** Conservative triage, not a prediction that a sender is a confirmed buyer. */
export function classifyBuyer(
  sender: string,
  subject: string,
  body = "",
  truncated = false,
) {
  const address = sender.trim().toLowerCase(),
    domain = address.split("@").pop() || "";
  const subjectText = subject.replace(/&(?:#39|apos);/gi, "'");
  if (
    /(?:^|\.)(?:facebookmail\.com|facebook\.com|linkedin\.com|mail\.instagram\.com|accounts\.google\.com)$/.test(
      domain,
    )
  )
    return {
      candidate: false,
      reason: "Automated platform notification",
      evidence: [] as string[],
    };
  if (
    /\b(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|notifications?)@/.test(
      address,
    ) &&
    !/\b(?:RFQ|new (?:inquiry|enquiry)|quote\s*\/\s*contact request)\b/i.test(
      subjectText,
    )
  )
    return {
      candidate: false,
      reason: "Automated sender without a buying request",
      evidence: [] as string[],
    };
  if (
    /\b(?:security alert|password reset|verify your|newsletter|weekly digest|team superpower|conversions? you(?:'|’| a)re|ad performance|advertising|unsubscribe|promotional offer)\b/i.test(
      subjectText,
    )
  )
    return {
      candidate: false,
      reason: "Notification or promotional message",
      evidence: [] as string[],
    };
  const explicit =
    /\b(?:RFQ|request for (?:a )?(?:quotation|quote)|quotation (?:enquiry|inquiry|request)|distribution partnership (?:enquiry|inquiry)|new (?:enquiry|inquiry)|quote\s*\/\s*contact request)\b|\[Petronik Quote\]/i;
  if (explicit.test(subjectText))
    return {
      candidate: true,
      reason: "Subject contains an explicit enquiry or RFQ; review required",
      evidence: [subject.slice(0, 240)],
    };
  if (truncated)
    return {
      candidate: false,
      reason: "Insufficient complete buying evidence",
      evidence: [] as string[],
    };
  const text = body.slice(0, 12000);
  const request = text.match(
    /\b(?:please (?:quote|provide (?:a )?(?:quote|quotation|pricing))|we (?:need|require|want to (?:buy|purchase))|looking to (?:buy|purchase)|can you (?:quote|supply))\b[^.!?\n]{0,150}/i,
  );
  const product =
    /\b(?:SN\s*\d{2,4}|base oils?|bitumen|lubricants?|grease|diesel|hydraulic|\d+(?:\.\d+)?\s*(?:MT|kg|litres?|tons?|units?))\b/i.test(
      `${subjectText}\n${text}`,
    );
  return request && product
    ? {
        candidate: true,
        reason:
          "Explicit buying request with a product or quantity; review required",
        evidence: [request[0].slice(0, 240)],
      }
    : {
        candidate: false,
        reason: "No explicit buying request with sufficient context",
        evidence: [] as string[],
      };
}
