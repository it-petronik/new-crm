// Records contain plain text, never executable HTML.
export function TermsBody({ text }: { text: string }) {
  return <p className="whitespace-pre-wrap">{text}</p>;
}
