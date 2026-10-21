# CRM table controls

Local UI review, 21 October 2026. No production data, permissions or provider credits changed.

| Table | Filter and ordering |
| --- | --- |
| Business records (quotations, orders, customers, suppliers, products, accounts, employees and other modules) | Search/status; sortable record, status, owner, next date and value columns; full permitted set before pagination |
| Activity log | Search; actor, action, company and timestamp column sorting |
| Users | Search/status; person, role and account-state sorting |
| Lead register and reporting breakdowns | Search, ownership, stage and task filters; column/card ordering; each breakdown has search and sortable columns |
| Cashbook | Search/status plus company/currency/type controls; description, company, date, amount, creator and status sorting |
| HR registers | Search/status/month/category; employee, details, period and status sorting; private records remain server scoped |
| Management employee performance | Name/role, department, account and activity filters; sortable work/performance columns |
| Department work | Search/status, clickable status counts; record, status, owner, next date and updated sorting |
| Supplier offer comparison | Search/currency; supplier, price, payment, delivery, validity and origin ordering |
| Supplier offer history | Search/status; offer, price, incoterm and validity ordering |
| Record line items | Search and product/quantity/unit-price/total ordering; view only, original saved line order and full document total unchanged |
| CSV import preview | Search and row/name/contact/product ordering across all ready rows; filtering does not remove rows from the confirmed import |
| AI follow-up confirmation | Search/status and record/date/result ordering; a clear all-record count is shown because filtering does not change the action's scope |
| Meeting participants | Search/type and name/join/leave/duration ordering |
| Apollo staged result cards | Local search, CRM-match filter, name/company ordering on the staged page only; source order, selections and credit confirmations remain unchanged |

Printable quotations/invoices and printable meeting reports intentionally have no interactive filter or sorting controls. Printing preserves the saved commercial document and all its lines.

`tests/table-controls-audit.test.ts` inventories table markup and guards against adding an interactive table without column sorting and filtering. Runtime browser checks separately exercise the shared controls, department tables, HR, lead lists and hover states.
