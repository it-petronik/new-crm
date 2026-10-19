"use client";
import { useCallback, useEffect, useId, useState } from "react";
import { Plus, Package, Truck, Wallet, ClipboardList } from "lucide-react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogPresence,
  Field,
  Input,
  Select,
  Textarea,
} from "../ui/controls";
import {
  EmptyState,
  FormGrid,
  PageHeader,
  Surface,
  Tabs,
  Toolbar,
} from "../ui/layout";
import { StatusBadge, TonePill } from "../ui/status-badge";
import { businessToday, businessStampShort } from "@/lib/gst";
import type { Actor, RecordItem } from "@/lib/domain";
import {
  amountText,
  operationsAccess,
  quantityText,
} from "@/lib/operations/model";
import type { OperationsView } from "@/lib/operations/store";
import { useUnsavedChanges } from "../use-unsaved";
import styles from "./operations.module.css";

type PO = OperationsView["purchases"][number];
type Bill = OperationsView["invoices"][number];
type Move = OperationsView["movements"][number];
type Mode =
  | { action: "purchase" }
  | { action: "status"; p: PO; status: "Approved" | "Closed" | "Cancelled" }
  | { action: "movement"; p: PO; kind: "Receipt" | "Dispatch" }
  | { action: "invoice"; p: PO }
  | { action: "payment"; bill: Bill; p: PO }
  | { action: "reverse"; move: Move; p: PO };
type Tab = "purchases" | "inventory" | "invoices" | "deliveries";
async function api<T>(
  url: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal,
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "The operation could not be completed.");
  return result;
}

export default function OperationsPage({
  actor,
  company,
  records,
}: {
  actor: Actor;
  company: string;
  records: RecordItem[];
}) {
  const [data, setData] = useState<OperationsView | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [tab, setTab] = useState<Tab>("purchases"),
    [query, setQuery] = useState(""),
    [mode, setMode] = useState<Mode | null>(null),
    [refresh, setRefresh] = useState(0);
  const load = useCallback(() => setRefresh((n) => n + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setData(null);
    api<OperationsView>(
      `/api/operations?company=${encodeURIComponent(company)}`,
      undefined,
      controller.signal,
    ).then(setData, (e) => {
      if (!controller.signal.aborted) setError(e.message);
    });
    return () => controller.abort();
  }, [company, refresh]);
  const access = data?.access || operationsAccess(actor);
  if (!access.view)
    return (
      <EmptyState
        title="Operations isn't available for your role"
        detail="Ask your workspace manager if you need operational access."
      />
    );
  const find = (id: string) => data?.purchases.find((p) => p.id === id);
  const matches = (p: PO) =>
    `${p.id} ${p.names.orderId} ${p.names.supplierId} ${p.names.productId} ${p.warehouse} ${p.status}`
      .toLowerCase()
      .includes(query.toLowerCase());
  const purchases = data?.purchases.filter(matches) || [];
  const action = (value: Mode) => {
    setNotice("");
    setMode(value);
  };
  const summary = (p: PO) => (
    <div className={styles.meta}>
      <span>{p.company}</span>
      <span>{p.warehouse}</span>
      <span>
        {quantityText(p.quantity)} {p.unit} ordered
      </span>
      <span>{quantityText(p.received)} received</span>
      <span>{quantityText(p.balance)} on hand</span>
      <span>Expected {p.expectedDate}</span>
    </div>
  );
  return (
    <div className={styles.page}>
      <PageHeader
        title="Operations"
        description="Purchasing, stock and supplier payments — connected to your sales orders."
        actions={
          access.purchase && (
            <Button
              variant="primary"
              onClick={() => action({ action: "purchase" })}
            >
              <Plus size={16} />
              New purchase order
            </Button>
          )
        }
      />
      <div className={styles.stats}>
        <div className={styles.stat}>
          <ClipboardList size={18} />
          <strong>
            {data?.purchases.filter((p) => p.status === "Draft").length ?? "—"}
          </strong>
          <span>Awaiting approval</span>
        </div>
        <div className={styles.stat}>
          <Package size={18} />
          <strong>
            {data?.purchases.filter(
              (p) => p.status === "Approved" && p.received < p.quantity,
            ).length ?? "—"}
          </strong>
          <span>Awaiting full receipt</span>
        </div>
        <div className={styles.stat}>
          <Truck size={18} />
          <strong>
            {data?.purchases.filter((p) => p.balance > 0).length ?? "—"}
          </strong>
          <span>Purchase lots with stock</span>
        </div>
        {access.costs && (
          <div className={styles.stat}>
            <Wallet size={18} />
            <strong>
              {data?.invoices.filter(
                (i) =>
                  i.paidCents < i.amountCents && i.dueDate < businessToday(),
              ).length ?? "—"}
            </strong>
            <span>Overdue supplier invoices</span>
          </div>
        )}
      </div>
      {error && (
        <div className={styles.error} role="alert">
          {error}{" "}
          <Button variant="secondary" onClick={load}>
            Try again
          </Button>
        </div>
      )}
      {notice && (
        <p className={styles.success} role="status">
          {notice}
        </p>
      )}
      <Tabs<Tab>
        idBase="operations"
        label="Operations views"
        active={tab}
        onChange={setTab}
        items={[
          { id: "purchases", label: "Purchase orders" },
          { id: "inventory", label: "Inventory" },
          { id: "invoices", label: "Supplier invoices", hidden: !access.costs },
          { id: "deliveries", label: "Deliveries" },
        ]}
      />
      <Toolbar>
        <Input
          className={styles.search}
          aria-label="Search operations"
          placeholder="Search order, supplier, product or warehouse"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button variant="secondary" onClick={load}>
          Refresh
        </Button>
      </Toolbar>
      {!data && !error && (
        <p className={styles.hint} role="status">
          Loading operations…
        </p>
      )}
      {data?.truncated && (
        <p className={styles.hint}>
          Showing the latest 80 purchase orders and up to 500 ledger entries.
          Stock and payment balances include all entries for those purchases.
        </p>
      )}
      {data && (
        <Surface padding="none">
          <div
            className={styles.list}
            role="list"
            aria-label={
              tab === "purchases"
                ? "Purchase orders"
                : tab === "inventory"
                  ? "Inventory lots"
                  : tab === "invoices"
                    ? "Supplier invoices"
                    : "Delivery ledger"
            }
          >
            {(tab === "purchases" || tab === "inventory") &&
              purchases
                .filter((p) => tab !== "inventory" || p.status !== "Cancelled")
                .map((p) => (
                  <div className={styles.row} role="listitem" key={p.id}>
                    <div className={styles.identity}>
                      <strong>
                        {p.names.productId} · {p.names.orderId}
                      </strong>
                      <div className={styles.meta}>
                        <span>{p.id}</span>
                        <span>{p.names.supplierId}</span>
                      </div>
                      {summary(p)}
                      <div className={styles.meta}>
                        <StatusBadge status={p.status} />
                        {access.costs && p.totalCents !== undefined && (
                          <span>
                            {amountText(p.totalCents, p.currency)} ·{" "}
                            {amountText(p.priceCents!, p.currency)}/{p.unit}
                          </span>
                        )}
                      </div>
                      {p.notes && <p className={styles.hint}>{p.notes}</p>}
                    </div>
                    <div className={styles.actions}>
                      {access.purchase &&
                        p.status === "Draft" &&
                        p.createdBy !== actor.id && (
                          <Button
                            variant="primary"
                            onClick={() =>
                              action({
                                action: "status",
                                p,
                                status: "Approved",
                              })
                            }
                          >
                            Approve
                          </Button>
                        )}
                      {p.status === "Draft" && p.createdBy === actor.id && (
                        <span className={styles.hint}>
                          Another manager must approve
                        </span>
                      )}
                      {access.purchase && p.status === "Approved" && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            action({ action: "status", p, status: "Closed" })
                          }
                        >
                          Close purchase
                        </Button>
                      )}
                      {access.purchase &&
                        ["Draft", "Approved"].includes(p.status) && (
                          <Button
                            variant="secondary"
                            onClick={() =>
                              action({
                                action: "status",
                                p,
                                status: "Cancelled",
                              })
                            }
                          >
                            Cancel
                          </Button>
                        )}
                      {access.stock && p.status === "Approved" && (
                        <>
                          <Button
                            variant="secondary"
                            onClick={() =>
                              action({ action: "movement", p, kind: "Receipt" })
                            }
                          >
                            Receive stock
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={p.balance <= 0}
                            onClick={() =>
                              action({
                                action: "movement",
                                p,
                                kind: "Dispatch",
                              })
                            }
                          >
                            Dispatch
                          </Button>
                        </>
                      )}
                      {access.finance &&
                        ["Approved", "Closed"].includes(p.status) && (
                          <Button
                            variant="secondary"
                            onClick={() => action({ action: "invoice", p })}
                          >
                            Add invoice
                          </Button>
                        )}
                    </div>
                  </div>
                ))}
            {tab === "invoices" &&
              data.invoices
                .filter((i) => {
                  const p = find(i.purchaseId);
                  return p && matches(p);
                })
                .map((i) => {
                  const p = find(i.purchaseId)!;
                  return (
                    <div className={styles.row} role="listitem" key={i.id}>
                      <div className={styles.identity}>
                        <strong>
                          {i.reference} · {p.names.supplierId}
                        </strong>
                        <div className={styles.meta}>
                          <span>{p.names.orderId}</span>
                          <span>Issued {i.date}</span>
                          <span>Due {i.dueDate}</span>
                        </div>
                        <div className={styles.meta}>
                          <span>
                            {amountText(i.amountCents, p.currency)} invoiced
                          </span>
                          <span>
                            {amountText(i.paidCents, p.currency)} paid
                          </span>
                          <strong>
                            {amountText(
                              i.amountCents - i.paidCents,
                              p.currency,
                            )}{" "}
                            remaining
                          </strong>
                          <TonePill
                            tone={
                              i.paidCents === i.amountCents
                                ? "success"
                                : i.dueDate < businessToday()
                                  ? "danger"
                                  : "warning"
                            }
                          >
                            {i.paidCents === i.amountCents
                              ? "Paid"
                              : i.paidCents > 0
                                ? "Partially paid"
                                : "Unpaid"}
                          </TonePill>
                        </div>
                        <div className={styles.meta}>
                          {data.payments
                            .filter((pay) => pay.invoiceId === i.id)
                            .map((pay) => (
                              <span key={pay.id}>
                                {pay.date} · {pay.reference} ·{" "}
                                {amountText(pay.amountCents, p.currency)}
                              </span>
                            ))}
                        </div>
                      </div>
                      {access.finance && i.paidCents < i.amountCents && (
                        <Button
                          variant="primary"
                          onClick={() =>
                            action({ action: "payment", bill: i, p })
                          }
                        >
                          Record payment
                        </Button>
                      )}
                    </div>
                  );
                })}
            {tab === "deliveries" &&
              data.movements
                .filter((m) => {
                  const p = find(m.purchaseId);
                  return p && matches(p);
                })
                .map((m) => {
                  const p = find(m.purchaseId)!;
                  return (
                    <div className={styles.row} role="listitem" key={m.id}>
                      <div className={styles.identity}>
                        <strong>
                          {m.kind} · {quantityText(Math.abs(m.quantity))}{" "}
                          {p.unit}
                        </strong>
                        <div className={styles.meta}>
                          <span>{p.names.productId}</span>
                          <span>{p.warehouse}</span>
                          <span>{m.date}</span>
                          <span>{m.reference}</span>
                        </div>
                        <div className={styles.meta}>
                          {m.shipment ? (
                            <span>Shipment: {m.shipment.title}</span>
                          ) : m.restrictedShipment ? (
                            <span>Restricted shipment</span>
                          ) : null}
                          {m.reversalOf && (
                            <span>Correction of {m.reversalOf}</span>
                          )}
                        </div>
                        {m.notes && <p className={styles.hint}>{m.notes}</p>}
                      </div>
                      {access.stock &&
                        !m.reversalOf &&
                        !data.movements.some((r) => r.reversalOf === m.id) && (
                          <Button
                            variant="secondary"
                            onClick={() =>
                              action({ action: "reverse", move: m, p })
                            }
                          >
                            Reverse entry
                          </Button>
                        )}
                    </div>
                  );
                })}
            {(((tab === "purchases" || tab === "inventory") &&
              !purchases.length) ||
              (tab === "invoices" &&
                !data.invoices.some((i) => {
                  const p = find(i.purchaseId);
                  return p && matches(p);
                })) ||
              (tab === "deliveries" &&
                !data.movements.some((m) => {
                  const p = find(m.purchaseId);
                  return p && matches(p);
                }))) && (
              <EmptyState
                title="No matching entries"
                detail={
                  tab === "purchases"
                    ? "Create a purchase order from a confirmed sales order to get started."
                    : "Entries appear as you receive stock, dispatch deliveries and record supplier invoices."
                }
              />
            )}
          </div>
        </Surface>
      )}
      <p className={styles.hint}>
        Each purchase order tracks one product, unit and warehouse. Receipts add
        stock; dispatches reduce it. Recording a dispatch does not mark the
        shipment delivered. Supplier invoice amounts are reviewed totals in the
        purchase currency, with no automatic tax or exchange-rate calculation.
      </p>
      {data && data.history.length > 0 && (
        <details>
          <summary>Operations history</summary>
          <ul className={styles.history}>
            {data.history.map((h) => (
              <li key={h.id}>
                <strong>{h.action}</strong>
                <span>
                  {h.actor} · {businessStampShort(h.at)} · {h.recordId}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <DialogPresence>
        {mode && (
          <OperationDialog
            actor={actor}
            mode={mode}
            records={records}
            defaultCompany={company}
            onClose={() => setMode(null)}
            onSaved={() => {
              setMode(null);
              setNotice("Saved. The operations ledger has been updated.");
              load();
            }}
          />
        )}
      </DialogPresence>
    </div>
  );
}

function OperationDialog({
  actor,
  mode,
  records,
  defaultCompany,
  onClose,
  onSaved,
}: {
  actor: Actor;
  mode: Mode;
  records: RecordItem[];
  defaultCompany: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [requestId] = useState(() => crypto.randomUUID()),
    formId = useId(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const unsaved = useUnsavedChanges(busy);
  const [values, setValues] = useState<Record<string, string>>({
    company:
      defaultCompany !== "All companies" ? defaultCompany : actor.companies[0],
    orderId: "choose",
    supplierId: "choose",
    productId: "choose",
    warehouse: "Main warehouse",
    quantity: "",
    price: "",
    currency: "USD",
    unit: "MT",
    expectedDate: businessToday(),
    date: businessToday(),
    dueDate: businessToday(),
    notes: "",
    reference: "",
    shipmentId: "choose",
    amount: "",
  });
  const set = (key: string, value: string) =>
    setValues((old) => ({ ...old, [key]: value }));
  const p = "p" in mode ? mode.p : null;
  const title =
    mode.action === "purchase"
      ? "New purchase order"
      : mode.action === "status"
        ? `${mode.status} purchase order`
        : mode.action === "movement"
          ? mode.kind === "Receipt"
            ? "Receive stock"
            : "Dispatch stock"
          : mode.action === "invoice"
            ? "Record supplier invoice"
            : mode.action === "payment"
              ? "Record supplier payment"
              : "Reverse stock entry";
  const options = (kind: RecordItem["kind"]) =>
    records.filter(
      (r) => !r.deletedAt && r.kind === kind && r.company === values.company,
    );
  const selectedOrder = records.find((r) => r.id === values.orderId);
  const pick = (key: string, label: string, list: RecordItem[]) => (
    <Field>
      {label}
      <Select
        aria-label={label}
        value={values[key]}
        onChange={(e) => set(key, e.target.value)}
      >
        <option value="choose">Choose {label.toLowerCase()}</option>
        {list.map((r) => (
          <option key={r.id} value={r.id}>
            {r.title} · {r.id}
          </option>
        ))}
      </Select>
    </Field>
  );
  const input = (
    key: string,
    label: string,
    type = "text",
    required = true,
  ) => (
    <Field>
      {label}
      <Input
        aria-label={label}
        type={type}
        value={values[key]}
        required={required}
        onChange={(e) => set(key, e.target.value)}
        inputMode={
          ["quantity", "price", "amount"].includes(key) ? "decimal" : undefined
        }
      />
    </Field>
  );
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      let body: unknown;
      const { date, notes, reference } = values;
      if (mode.action === "purchase") {
        const {
          orderId,
          supplierId,
          productId,
          warehouse,
          quantity,
          price,
          currency,
          unit,
          expectedDate,
        } = values;
        if ([orderId, supplierId, productId].includes("choose"))
          throw new Error("Choose a sales order, supplier and product.");
        body = {
          action: "purchase",
          requestId,
          values: {
            orderId,
            supplierId,
            productId,
            warehouse,
            quantity,
            price,
            currency,
            unit,
            expectedDate,
            notes,
          },
        };
      } else if (mode.action === "status")
        body = {
          action: "status",
          id: mode.p.id,
          version: mode.p.version,
          status: mode.status,
        };
      else if (mode.action === "movement")
        body = {
          action: "movement",
          requestId,
          purchaseId: mode.p.id,
          kind: mode.kind,
          quantity: values.quantity,
          shipmentId:
            mode.kind === "Dispatch" && values.shipmentId !== "choose"
              ? values.shipmentId
              : null,
          date,
          notes,
          reference,
        };
      else if (mode.action === "invoice")
        body = {
          action: "invoice",
          requestId,
          purchaseId: mode.p.id,
          amount: values.amount,
          date,
          dueDate: values.dueDate,
          notes,
          reference,
        };
      else if (mode.action === "payment")
        body = {
          action: "payment",
          requestId,
          invoiceId: mode.bill.id,
          amount: values.amount,
          date,
          notes,
          reference,
        };
      else
        body = {
          action: "reverse",
          requestId,
          movementId: mode.move.id,
          date,
          notes,
          reference,
        };
      await api("/api/operations", body);
      unsaved.reset();
      onSaved();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The operation could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Dialog title={title} onClose={busy ? () => {} : unsaved.guard(onClose)}>
        {p && (
          <p className={styles.hint}>
            {p.names.productId} · {p.names.orderId} · {p.company} ·{" "}
            {p.warehouse}
          </p>
        )}
        <form id={formId} onSubmit={submit} onChangeCapture={unsaved.markDirty}>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          {mode.action === "status" ? (
            <p>
              {mode.status === "Approved"
                ? "Approve the quantity, price and supplier on this purchase order. Its commercial terms will remain fixed."
                : mode.status === "Closed"
                  ? "Close this purchase order to stop further receipts and dispatches. Its ledger and invoices remain available."
                  : "Cancel this purchase order. Purchases with stock or invoice history cannot be cancelled."}
            </p>
          ) : (
            <FormGrid>
              {mode.action === "purchase" && (
                <>
                  <Field>
                    Company
                    <Select
                      aria-label="Company"
                      value={values.company}
                      onChange={(e) =>
                        setValues((v) => ({
                          ...v,
                          company: e.target.value,
                          orderId: "choose",
                          supplierId: "choose",
                          productId: "choose",
                        }))
                      }
                    >
                      {actor.companies.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </Select>
                  </Field>
                  {pick(
                    "orderId",
                    "Sales order",
                    options("orders").filter((r) =>
                      ["Confirmed", "In Progress", "Completed"].includes(
                        r.status,
                      ),
                    ),
                  )}
                  {pick(
                    "supplierId",
                    "Supplier",
                    options("suppliers").filter(
                      (r) =>
                        !selectedOrder || r.branch === selectedOrder.branch,
                    ),
                  )}
                  {pick(
                    "productId",
                    "Product",
                    options("products").filter(
                      (r) =>
                        !selectedOrder || r.branch === selectedOrder.branch,
                    ),
                  )}
                  {input("warehouse", "Warehouse")}
                  {input("quantity", "Quantity")}
                  {input("price", "Unit price")}
                  <Field>
                    Currency
                    <Select
                      aria-label="Currency"
                      value={values.currency}
                      onChange={(e) => set("currency", e.target.value)}
                    >
                      {[
                        "USD",
                        "AED",
                        "EUR",
                        "GBP",
                        "INR",
                        "SAR",
                        "CNY",
                        "SGD",
                      ].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field>
                    Unit
                    <Select
                      aria-label="Unit"
                      value={values.unit}
                      onChange={(e) => set("unit", e.target.value)}
                    >
                      {["MT", "KG", "L", "DRUM", "IBC", "UNIT"].map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </Select>
                  </Field>
                  {input("expectedDate", "Expected receipt", "date")}
                </>
              )}
              {mode.action === "movement" && (
                <>
                  {input("quantity", `Quantity (${mode.p.unit})`)}
                  {mode.kind === "Dispatch" &&
                    pick(
                      "shipmentId",
                      "Shipment",
                      records.filter(
                        (r) =>
                          !r.deletedAt &&
                          r.kind === "logistics" &&
                          r.parentId === mode.p.orderId &&
                          !["Cancelled", "Delivered"].includes(r.status),
                      ),
                    )}
                </>
              )}
              {(mode.action === "invoice" || mode.action === "payment") &&
                input("amount", `Amount (${mode.p.currency})`)}
              {mode.action === "invoice" && (
                <p className={styles.hint}>
                  Remaining purchase value:{" "}
                  {amountText(
                    (mode.p.totalCents ?? 0) - (mode.p.invoicedCents ?? 0),
                    mode.p.currency,
                  )}
                  . Posted invoices and payments are retained as permanent
                  records; review the number, amount and dates before
                  confirming.
                </p>
              )}
              {mode.action === "payment" && (
                <p className={styles.hint}>
                  Remaining invoice balance:{" "}
                  {amountText(
                    mode.bill.amountCents - mode.bill.paidCents,
                    mode.p.currency,
                  )}
                </p>
              )}
              {mode.action !== "purchase" && (
                <>
                  {input(
                    "reference",
                    mode.action === "invoice"
                      ? "Supplier invoice number"
                      : "Reference",
                  )}
                  {input("date", "Date", "date")}
                </>
              )}
              {mode.action === "invoice" &&
                input("dueDate", "Due date", "date")}
              {mode.action === "reverse" && (
                <p className={styles.hint}>
                  Reverse {mode.move.kind.toLowerCase()} of{" "}
                  {quantityText(Math.abs(mode.move.quantity))} {mode.p.unit}.
                  The original entry is retained in the ledger.
                </p>
              )}
              <Field className={styles.wide}>
                Notes
                <Textarea
                  aria-label="Notes"
                  value={values.notes}
                  maxLength={2000}
                  onChange={(e) => set("notes", e.target.value)}
                />
              </Field>
            </FormGrid>
          )}
        </form>
        <DialogActions
          onCancel={unsaved.guard(onClose)}
          pending={busy}
          primary={{
            label: "Confirm and save",
            pendingLabel: "Saving…",
            type: "submit",
            form: formId,
            pending: busy,
          }}
        />
      </Dialog>
      {unsaved.confirm}
    </>
  );
}
