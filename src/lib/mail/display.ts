export function compactMailText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\[cid:[^\]]+\]/gi, "[Inline image — see attachments]")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n[\t ]*\n(?:[\t ]*\n)+/g, "\n\n")
    .trim();
}
