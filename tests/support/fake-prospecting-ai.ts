/** Deterministic fictional model output. Imported only by test entrypoints/tests. */
export function fakeProspectingInterpretation(query: string) {
  if (/ignore permissions|export every customer/i.test(query))
    return { intent: "unsupported", filters: [], roles: [] };
  const person = /procurement|purchasing|decision.maker/i.test(query);
  const country = /Vietnam/i.test(query)
    ? "Vietnam"
    : /Tanzania/i.test(query)
      ? "Tanzania"
      : /Kenya/i.test(query)
        ? "Kenya"
        : /South Africa/i.test(query)
          ? "South Africa"
          : /Indonesia/i.test(query)
            ? "Indonesia"
            : /East Africa/i.test(query)
              ? "Kenya, Tanzania, Uganda"
              : /UAE/i.test(query)
                ? "United Arab Emirates"
                : "";
  const keywords = /bitumen|asphalt/i.test(query)
    ? "bitumen, asphalt"
    : /SN500/i.test(query)
      ? "SN500, base oil"
      : /base oil/i.test(query)
        ? "base oil, base oils"
        : /grease/i.test(query)
          ? "grease, manufacturer"
          : "lubricant, lubricants, manufacturer";
  return {
    intent: person ? "person" : "company",
    filters: [
      { key: "keywords", value: keywords },
      ...(country ? [{ key: "location", value: country }] : []),
      ...(person
        ? [
            {
              key: "titles",
              value: /purchasing/i.test(query)
                ? "Purchasing Manager"
                : "Procurement Manager",
            },
          ]
        : []),
    ],
    roles: [
      "Procurement",
      "Purchasing",
      "Import/Export",
      "Commercial",
      "Management",
    ],
  };
}
