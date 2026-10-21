/** Approved company contacts, shared by quotations and proformas. Never use
 * customer/document overrides here or copy contacts across company boundaries. */
export function companyFooter(company: string) {
  const contacts: Record<
    string,
    { phone?: string; email?: string; website: string }
  > = {
    Petronik: {
      phone: "+971 (4) 2669953",
      email: "info@petronik.ae",
      website: "www.petronik.ae",
    },
    Afrilube: { website: "www.afrilube.com" },
    Petronex: { website: "www.petronex.co" },
    Istanegry: { website: "www.istanegry.com" },
    Enercore: { website: "" }, // No approved commercial contact details supplied yet.
  };
  return { message: "Thank you for your business.", ...contacts[company] };
}
