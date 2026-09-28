# Commercial operations — Phase 6

## Architecture decisions (reviewed before implementation)

BusinessRecord owns Customer, Supplier, Product, Lead, Quotation, Order, shipment and invoice identity. Existing API, CSV, workflow, audit, ownership and module rules remain the entry points. Customers are branch-specific today: preserve exact company/branch equality when linking. Display names are not identity. Optional relationship IDs live in the existing typed payload, with SQLite expression indexes and integrity triggers; there are no duplicate relationship columns to synchronize.

Implement now:
- **Contact**: one customer or supplier parent, name, optional business details, active, version, timestamps. Employees with parent write access maintain it; parent readers consume it. A separate table owns stable person identity and enforces the one-parent invariant. Company/branch must equal the parent. Email/phone are not unique.
- **Deal**: id, unique leadId, company/branch, createdAt. Explicit employee action creates it. Lead readers consume it. Unique leadId is the database concurrency invariant. Owner, stage, customer, contact, requirement and next action derive from Lead; no copied editable fields.
- **SupplierProductCapability**: supplier/product IDs, scope, optional grade/origin/MOQ/unit/packaging/lead time/notes, active, version, timestamps. Supplier editors record reviewed knowledge, both Supplier and Product access is required to read it. No price, terms, validity, availability or AI-derived capability.

Defer:
- **CommercialRequirement**: Lead fields already own the reviewed CRM requirement and Phase 2/3 distinguish requested/preferred/proposed/confirmed/agreed source evidence. A new editable copy would compete. Deal reads Lead; extraction remains a proposal reviewed through the existing Sales Copilot.
- **DealSupplier**: deterministic active capability matches satisfy the candidate foundation without inventing selection or procurement states. No persisted shortlist yet.
- **PriceObservation**: priced quotation lines already carry currency and history; a separate table would duplicate facts without a reviewed buy-price ingestion workflow. Future observations need explicit SUPPLIER_OFFER/CUSTOMER_TARGET/ENERCORE_SELL_QUOTE/ACTUAL_BUY/ACTUAL_SELL type, source, currency, unit, date and restricted buy-cost access. Never infer FX or market prices.
- **ApprovalRequest**: existing quotation/leave approvals remain authoritative. Future LOW_MARGIN, EXCEPTIONAL_DISCOUNT, PAYMENT_TERM_EXCEPTION, SUPPLIER_SELECTION and CREDIT_EXCEPTION need typed entity references, requester, eligible approvers, decision audit and versioned policy. No thresholds or extra inbox now.

## Source of truth and safety

Customer/Supplier/Product: BusinessRecord.id. Display names: master title; historical fields remain snapshots. A submitted customerId is resolved and the server normalizes the title. contactId must belong to that customer; productId resolves product. Unrelated edits of legacy rows do not require linking. Reassignment requires explicit confirmation and clears the old contact. Primary contact must be active and belong to its parent; deactivation clears the primary link atomically. Contacts never change parent.

Deal → Lead is persisted and unique. Deal → Customer, owner and reviewed requirement are derived from Lead. Accepted quotations copy their stable links to existing downstream records. A Deal created after a quotation is still reachable through its Lead ancestry. Meetings reuse authorized relatedRecordId links to Lead/Customer/Supplier; Deal adds no second meeting identity.

Every aggregate authorizes its root, then each child independently. Counts describe returned authorized rows only. Contact access inherits parent; capability requires both endpoints. Known IDs, saved preferences and AI references grant nothing. Bounded SQL queries apply company/branch/module/ownership before aggregation. Passive pages and matching call no AI. AI context uses the same authorized relationships; relationship versions and facts enter the existing context-based cache fingerprint.

Linked history and possible legacy name matches are separate. No fuzzy linking or automatic merge. CSV names remain human-readable and unlinked unless an employee reviews a link. No automatic backfill, notifications or Action Center cleanup signals.

New writes refuse preview with 409. Production and secrets are never used for validation. R2 and Phase 4 remain disabled. Future document extraction may propose reviewed relationships only after separate authorization; future email/WhatsApp can use Contact IDs without changing this model.

## Migration and rollback

0013_commercial_operations.sql adds three tables, expression indexes and integrity triggers. All new payload keys are optional/null-compatible; no existing rows are rewritten. Physical deletion of referenced identities is restricted; use existing inactive/retained-history behavior. Fresh and upgrade validation must include foreign_key_check. An old Worker can read the additive schema, but its edits may omit optional relationship keys and cannot maintain Phase 6 invariants reliably: rollback requires disabling commercial edits or a compatibility patch, not dropping tables.
