# Phase 9 — purchasing, inventory and supplier payments

Implemented locally. Phase 4/R2 remains on hold. No production migration,
deployment, external sending or real financial transaction is part of this work.

## Workflow

Operations is one permission-gated workspace page at
`/workspace/{company}/operations`, under Delivery & payments. It provides
Purchase orders, Inventory, Supplier invoices and Deliveries tabs, a bounded
list, search, current counts and a separate operations audit history.

1. A purchasing manager creates a Draft purchase for one confirmed sales order,
   supplier, product, warehouse, unit, currency and expected receipt date.
2. A different purchasing manager approves it. Commercial terms are fixed;
   cancel and replace an incorrect draft. Approved purchases can be closed.
3. Logistics records partial receipts and dispatches. Each dispatch must link
   to an existing shipment under that purchase's sales order. Recording a
   dispatch does not change the shipment status or certify customer delivery.
4. A mistaken stock entry is corrected with an equal and opposite reversal.
   Originals are retained, each original permits one reversal, and reversing
   a receipt is refused if it would make stock negative. Closed lots permit
   corrections, but no new receipts or dispatches.
5. Accounts records supplier invoices against an Approved or Closed purchase,
   then partial payments with dates and references. Outstanding balances are
   derived from all payment entries, including entries outside the visible
   history window. Supplier invoice numbers are unique per company/supplier
   after NFKC normalization, lowercasing and whitespace normalization.

Purchases with any receipt, dispatch or invoice history cannot be cancelled.
Posted invoices and payments are immutable permanent records. The UI warns
before posting; credit notes, invoice voids and payment reversals are not part
of this release. Close stops fulfillment; it does not clear invoices or stock.

## Permissions

- MD, Group Manager and Branch Manager can purchase when Orders, Suppliers and
  Products are available with write access. Approval requires a different user.
- Logistics Managers can receive/dispatch/reverse with writable Logistics and
  readable Orders/Products. Logistics Executives do not gain a new cross-owner
  stock role. Logistics-only responses omit purchase prices, totals, invoices
  and payments on the server.
- Accounts Managers and Accountants can post invoices/payments with writable
  Accounts and readable linked Orders. Management uses the same module checks.
- Company and legacy branch scope apply independently to every operation.
  Every linked record is resolved by authoritative ID. Names and shipment
  details the reader cannot otherwise access are redacted. A purchase never
  expands normal record access.
- Linked CRM records cannot be soft-deleted or moved to another scope. A
  database trigger guards races in addition to the ordinary deletion check.

## Data and calculations

Migration `0018_operations.sql` adds PurchaseOrder, StockMovement,
SupplierInvoice and SupplierPayment, plus indexes and integrity/history guards.
It also adds a retention trigger to BusinessRecord; it changes no existing rows.
Migration 0017 is a prerequisite when upgrading a database still at 0016.

Quantities are positive decimal strings stored as integer millionths, up to
1,000,000 units per purchase. Unit prices have at most two decimals and are
stored as integer cents, up to 10,000,000 currency units. Extended totals use
BigInt multiplication and half-up rounding to cents. No density conversion,
unit conversion, implied FX or tax calculation is performed. Supplier invoice
amounts are explicitly reviewed totals in the purchase currency, capped by the
purchase value; tax/variance handling needs a separately reviewed extension.

Stock is tracked per purchase lot and warehouse: sum of signed movements.
It is not a pooled warehouse balance, reservation engine, valuation model,
inventory costing system or accounting general ledger. Multiple products use
separate purchase orders. Transfers, opening balances and supplier returns are
not included. Existing sourcing/offer/scenario calculations stay authoritative;
purchase creation is manual and never silently selects a supplier offer.

The database serializes over-receipt, negative-stock and overpayment checks
inside insert triggers. Request IDs prevent duplicate inserts and reject a
reused ID with changed quantity, invoice or payment details. Purchase status
updates carry a version and fail atomically with their audit entry if stale.
Writes and their audit are one D1 batch. History rows cannot be deleted.

## Bounds and recovery

Lists show the latest 80 scoped purchases, up to 500 stock movements, invoices
and payments, and 100 audit events, with a visible truncation notice. Search
applies to this disclosed window, not the whole database. Totals aggregate all
ledger entries for the shown purchases/invoices. Related record reads are
batched below D1's parameter limit. Record pickers use the existing workspace's
loaded records; large-catalog search/pagination is a later extension.

The recovery tool's explicit `operations` profile includes migrations through
0018 and keeps all prior commercial/tasks checks. It validates endpoint scope,
independent approval, extended amounts, stock limits, reversal identity,
invoice totals and payment limits. Restore loads original stock entries before
their reversals, and installs immutable guards after data loading.
Use `BACKUP_SCHEMA_VERSION=operations npm run db:backup` after a separately
approved release; a pre-0018 backup uses the actual preceding schema profile.

## Local review and verification

`npm run dev:review` now seeds fictional products, supplier, sales order,
shipment and four purchase lots: Draft, Approved, Closed and Cancelled. The
Approved lot has a partial receipt, dispatch, overdue invoice and payment.
The seed never connects remotely and retains existing review edits.

- Unit coverage: fixed-point calculations, approvals, stale writes, scope and
  role denial, cost redaction, concurrent receipts/dispatches/payments,
  duplicate invoice numbers, request replay, reversals and history retention.
- `playwright.operations.config.ts`: real local purchase form → second-manager
  approval → receipt → dispatch → supplier invoice → partial payment → reload;
  populated tabs at 1440/768/390px in light/dark; anonymous, role, company and
  origin denials. Review screenshots under `test-results/operations-*`.
- Recovery tests round-trip posted payments and reversed stock and reject
  corrupt balances. `tests/recovery_rehearsal.py` additionally upgrades and
  restores this ledger through actual isolated local D1 commands.

All data used for verification is fictional. See the run logs for the current
verification result; this document is not authorization to deploy.

## Verification result — 19 October 2026

The final unit run passed 508 tests with zero failures/skips. Type checking
and the OpenNext build passed. The final Operations browser run passed all
three scenarios, the Phase 8 browser run passed all four scenarios, and the
existing CRM workflow-polish suite passed all three scenarios. An
earlier Tasks run stalled while capturing a screenshot; the isolated rerun
completed its unchanged assertions. The real local D1 rehearsal reports
`operationsProfileValidated: true`, exact schema/row preservation and zero
foreign-key violations. No remote operation was performed.

Current fictional review: `http://localhost:8788/workspace/petronik/operations`.
Account `studio@collab.test`, password `Collab-Test-Password-1`. The seeded
Draft purchase was created by `cmmd@collab.test`, so Studio can review/approve
it without bypassing the separate-approver rule. The fresh review state is
`.wrangler/manual-review.phase9.9HYeuA`; older review states are retained.
