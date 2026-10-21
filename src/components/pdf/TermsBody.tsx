// Records contain plain text, never executable HTML.
export function TermsBody({ text }: { text: string }) {
  const clauses = text.split(/\n+(?=\s*\d{1,3}[.)]\s)/);
  return <>{clauses.map((clause, index) => {
    const match = clause.match(/^(\s*\d{1,3}[.)]\s+)([^:\n]{1,80}:)?([\s\S]*)$/);
    return <p className="pdf-term whitespace-pre-wrap" key={index}>{match ? <><strong>{match[1]}{match[2]}</strong>{match[3]}</> : clause}</p>;
  })}</>;
}
