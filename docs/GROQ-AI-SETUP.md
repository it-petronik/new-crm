# Groq AI setup and workflow guide

Enercore now targets Groq for hosted AI. Cloudflare continues hosting the CRM,
but its Workers AI binding and model fallback have been removed from the release
configuration. The office Mac is not an inference server. This candidate has not
been deployed or tested against a real Groq account.

## Activate privately

1. Revoke the key shared in chat. Create a replacement in the company Groq
   account; never paste it into chat, source code, a screenshot or a support log.
2. Review Groq organisation data controls before sending company information.
   Groq offers a Zero Data Retention setting; retention can otherwise apply for
   reliability or abuse investigation. See [Groq data controls](https://console.groq.com/docs/your-data).
3. In the existing Cloudflare Worker `enercore-crm-live`, open Settings and
   Variables and Secrets. Add the replacement as an encrypted secret named
   `GROQ_API_KEY`. Do not add a `NEXT_PUBLIC` variable or put it in Git.
4. Keep the non-secret variable `AI_PROVIDER=groq`. Deploy the reviewed release
   only after the secret and data controls are ready. No database migration or
   DNS change is needed for this AI switch.
5. Sign in with authorised team accounts. Check assistant availability, a
   fictional inquiry suggestion, a role-scoped question and a normal CRM save.
   Verify that unauthorised records remain inaccessible and no test endpoints
   are deployed. Never seed fictional accounts into the live CRM.

Without a valid secret, AI stays unavailable; ordinary CRM workflows remain
usable. There is no silent fallback to Cloudflare or another provider.

## Use the shortcuts

- New lead or Quick add: open **Fill from an inquiry**. Literal details are
  detected on the device while typing. **Fill empty fields** updates only the
  draft; review and save it normally. Existing entries are preserved.
- **Suggest with AI** appears only when hosted AI is configured and lead tools
  are permitted. That explicit click sends the pasted inquiry to Groq after
  detected secrets are redacted. Typing never sends a model request. Names,
  contact details and business requirements may remain in the submitted text.
- AI suggestions must match evidence in the inquiry. Missing or conflicting
  values are omitted. No owner, brand, price, approval, payment or follow-up
  decision is inferred by this helper.
- Existing lead briefs, follow-up drafts, meeting and conversation summaries,
  sales helpers and role-scoped questions use the same Groq gateway. References
  and proposed CRM updates retain their existing access and review checks.
- The desktop assistant offers role-specific starter questions. It is hidden
  when unavailable or not permitted; mobile keeps the existing navigation entry.

No email is sent and no record is saved, assigned, approved or paid automatically
by the model. Management figures are calculated by the CRM, not by the model.

## Models and allowance controls

`openai/gpt-oss-120b` handles primary explanations; `openai/gpt-oss-20b` handles
short extraction and routing. A failed request can try one other Groq model,
but authentication and allowance errors stop immediately. Requests have a
timeout, bounded output and server-side schema validation. Cached answers are
scoped to the person, supplied context and provider/model configuration.

Known question intents skip the model-routing call. There is no per-keystroke
inference or background AI monitoring. Metadata logs contain model, timing,
status and token counts rather than prompt or answer contents.

App reservations allow up to 150,000 estimated tokens in a rolling 24 hours,
7,000 in a minute and 800 model attempts in 24 hours, alongside existing
per-person limits. Schema and output allowance count towards estimates;
provider-reported use reconciles successful reservations. Failed attempts with
unknown usage keep their reservation. These are conservative app controls,
not the provider's tokenizer, a billing guarantee or a promise of free capacity.
Large questions may require selecting one brand or record.

The company's Groq account limits and plan remain authoritative. Verify them
in the account and [Groq rate limits](https://console.groq.com/docs/rate-limits).
No paid plan, subscription or automatic upgrade was enabled by this integration.

## Local review

The browser-local preview is
[Lead Desk](http://localhost:3000/workspace/all-companies/sales-pipeline).
It uses fictional data and never calls an AI provider. Local detection and draft
review work there; hosted AI suggestions require the separately configured
authenticated environment. The test transport uses fictional responses only.
