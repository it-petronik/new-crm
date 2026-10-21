# MD lead operations acceptance checklist

Status date: 21 October 2026. This is a local release checklist, not a production completion certificate.

The CRM is Enercore, with Petronik, Afrilube, Petronex, Istanergy and Enercore as the five configured brands. Preview uses fictional browser-local data. Connected-provider intake, live accounts, production data and staff adoption need separate acceptance.

## Requirements and completion boundaries

| MD requirement | Available in the local candidate | Remaining acceptance |
| --- | --- | --- |
| One place for every inquiry | Lead Desk and Quick add capture brand, source and buyer/supplier type. Cursor reporting covers the entire permitted lead scope, not only the first page. | Confirm every channel has a named capture owner and test real incoming inquiries. |
| Website inquiries | Signed, authenticated server-to-server intake exists per brand, with replay/deduplication controls and a validated owner. | Configure each website separately and demonstrate one successful inquiry per brand. No connection is assumed live. |
| Email, WhatsApp, social and advertising | These sources can be recorded manually in the same CRM. | Automatic connectors are not established by this work. Approve and test each provider connection, consent and duplicate handling before calling it automated. |
| Allocate work to Sales | Active, writable Sales Manager/Executive accounts can be selected during capture or assigned later. Creators retain visibility. New owners receive internal assignment notifications in the connected CRM. | Confirm brand coverage and actual accounts for the team; test each real login. Unknown legacy owner roles need review. |
| No lead left without feedback | Assigned to me, New for me, Follow up today, Needs feedback and Needs assignment queues. One outcome and next date; Not Relevant needs a reason. Saved Sales outcomes notify an authorised lead creator internally. | IT or an authorised manager checks exceptions daily. Notifications are best effort, not guaranteed delivery; the queue is the source of truth. |
| Product, grade, quantity, destination and customer details | Required before a tracked buyer inquiry can be qualified or move to later lead stages. Capture stays short when details are not yet known. | Practice one complete qualification with each salesperson. Confirm any imported/unclassified records rather than treating them as buyer demand. |
| Standard sales pipeline | Inquiry, qualification, approved/sent quotation, negotiation and linked order workflows exist. Existing approval and financial controls remain. | Complete one real authorised end-to-end test before release; do not select Won as proof of a confirmed order. See the operating guide for the stage mapping. |
| Management dashboard across all five brands | Scope-aware inquiry, qualification, quote, conversion, response, feedback and overdue measures. Brand/product/owner/source breakdowns; permitted zero-lead brands remain visible. | MD/IT/Liera review the same permitted scope and agree reporting dates and definitions. Restricted users never receive all-brand data automatically. |
| Weekly reporting | Tools → Export weekly report includes grouped summaries and lead-level commercial details, ownership and feedback evidence. | Schedule and actually hold the review; record decisions, action owner and deadline. The export uses a lead-creation cohort, not an independent count of every event occurring that week. |
| Daily duties and accountability | A short in-app Team guide and [staff operating guide](./CRM-STAFF-OPERATING-GUIDE.md) define capture, response, handoff and review. | Staff must demonstrate the workflow. Reports show recorded CRM activity, not attendance, productivity or proof of unrecorded conversations. |
| Staff training | Five short proposed sessions, role-specific exercises and sign-off criteria are documented. | Confirm calendar dates, trainer and brand access. No session has been booked or marked attended here. |
| Company control of digital accounts | CRM role/company/module controls and audit exist. | IT must independently verify website, domain, mailbox and ad-platform ownership, MFA, recovery and offboarding. CRM access alone does not prove external ownership. |

## Confirmed responsibilities

The user confirmed these functional responsibilities. This table is not a user-account or permission change.

| Person or function | Responsibility | Daily or weekly output |
| --- | --- | --- |
| Liera | Personal assistant; can run the weekly review | Prepare permitted summaries, collect exceptions and record review actions. Read-only review does not authorise editing or assigning leads. |
| Aleena | Sales | Capture own inquiries/prospects; act on assigned leads; record outcome, next date and qualification details. |
| Max | Sales | Same Sales responsibilities as Aleena, within confirmed brand access. |
| Mak | Logistics | Keep shipment and delivery updates current after an order handoff; raise delivery exceptions. |
| IT person | Weekly review facilitator and technical administration | May run the weekly review; maintain access and integrations; validate report refresh and channel/account ownership. |
| MD | Management and weekly review | May run the weekly review; approve response targets, accountability and escalations. |
| Marketing function; individual not yet named | Capture, source accuracy and lead quality | Register every inquiry; route it to one salesperson; review feedback and rejection reasons. |

Brand coverage for each person, the exact login-to-person mapping, a lead-allocation deputy, the review calendar and response-time target remain unconfirmed. Do not infer them from a name or job title. Only MD, MD Assistant and IT have all-lead visibility within their granted scopes; other users see leads they created or own.

## Release and team acceptance

Before saying all MD requirements are done, retain evidence for each item:

- [ ] Every real team login has the approved role, brands and module access; unrelated staff cannot open another salesperson's lead.
- [ ] All five brand websites pass signed intake, owner, retry/deduplication and failure tests, or the manual capture owner is explicitly accepted instead.
- [ ] Email, WhatsApp, social and ads each have an accepted manual process or separately approved and tested connector.
- [ ] Aleena and Max each capture an inquiry, receive an assignment, acknowledge, contact, save feedback and complete a follow-up without help.
- [ ] Marketing sees the Sales outcome and a Not Relevant reason; reassignment leaves earlier feedback as history and prompts the new owner for fresh feedback.
- [ ] One properly qualified inquiry produces an approved quotation and confirmed order; Mak can see the permitted handoff and update Logistics.
- [ ] IT, Liera and MD can each open permitted management reports; the chosen facilitator runs and records the first weekly review.
- [ ] Response target and escalation owner are approved. Unknown receipt times are not treated as zero-minute responses or SLA passes.
- [ ] All four staff complete their role-specific practice and training sign-off.
- [ ] IT verifies company ownership and recovery of website/domain/email/ad accounts without recording credentials in CRM notes.
- [ ] Release owner validates backup/rollback, required migrations, deployment and signed-in production acceptance separately.

## Research and process basis

Checked 21 October 2026:

- [HubSpot Academy Lead Management](https://academy.hubspot.com/courses/lead-management) is a free course covering qualification, routing, nurturing and marketing-to-sales alignment. Use as optional background; train staff on the actual Enercore screens.
- [Zoho guidance on lead-owner notifications](https://www.zoho.com/crm/resources/solutions/notify-salespeople-of-new-leads-at-a-specific-time.html) supports clear routing and deliberate notification workflows. Test automation with fictional records first; no outgoing email automation was enabled here.
- [International Trade Administration due diligence guidance](https://www.trade.gov/perform-due-diligence) supports verifying potential buyers and partners before committing resources. It is general research guidance, not a claim that US trade rules govern every transaction.

Product, grade, quantity/unit, destination, customer and salesperson are this team's required qualification fields. A prospect profile or scraped contact is not confirmed purchasing demand. Verify company identity, product requirement, decision-maker, commercial terms and any applicable compliance checks before issuing commitments; never invent unknown details.

## Local verification

Changes in this update: allocation queue for known non-sales/missing owners; internal creator feedback notifications; report summaries by brand, product/grade, owner and source; current New inquiry counts; quantity/unit/destination and missing-qualification details in the CSV. Dates and unknown timing remain explicit, access checks are reapplied, and spreadsheet-formula protection is retained.

Verified locally: 635 unit tests; TypeScript; production-format OpenNext build; 18 browser scenarios across Lead Desk and worklist regressions, including the expanded five-brand report at 360/768/1440px in light and dark themes. Isolated fictional database acceptance verified all 1,005 assigned test leads over three pages, internal creator feedback notification, silent acknowledgement/self-action, access and stale-update checks, and a signed-in browser save. The expanded mobile table overflow found during review was fixed.

Evidence logs: `/tmp/enercore-md-{unit,types,build,browser,worklist,connected}.log`. This does not assert production deployment, provider connections, staff attendance or completed live acceptance.
