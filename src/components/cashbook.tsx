"use client";
import { useState } from "react";
import { Plus, ArrowDownLeft, ArrowUpRight, Wallet } from "lucide-react";
import { Button, Select } from "./ui/controls";
import { Pagination, ListFilters, ListEmpty, usePagination } from "./pagination";
import { dateField } from "@/lib/list-query";
import { cashTotals, isCashEntry } from "@/lib/cashbook";
import { canWrite, type Actor, type RecordItem } from "@/lib/domain";
import { companyName } from "@/lib/company-name";
const money = (amount: number, currency: string) => new Intl.NumberFormat("en-US", { style:"currency", currency, minimumFractionDigits:2, maximumFractionDigits:2 }).format(amount);
export function Cashbook({ records, actor, company, onAdd, onOpen }: { records: RecordItem[]; actor: Actor; company: string; onAdd: () => void; onOpen: (r: RecordItem) => void }) {
  const [currency, setCurrency] = useState("USD");
  const [type, setType] = useState("All entries");
  const totals = cashTotals(records, currency);
  const entries = records.filter(r => isCashEntry(r) && r.currency === currency && (type === "All entries" || r.attributes?.entryType === type));
  // Filters use the transaction date shown in the table, not the entry's creation time.
  const pagination = usePagination(entries, `${company}|${currency}|${type}`, { dateOf: dateField("due"), dateLabel: "transaction date" });
  const writable = canWrite(actor, { kind:"accounts", company:company === "All companies" ? actor.companies[0] : company, branch:actor.branches[0] || "Main", ownerId:actor.id } as RecordItem);
  return <section className="panel cashbook-panel">
    <div className="panel-heading"><div><h2>Company income & expenses</h2><p>Manual cashbook · excludes invoices and invoice collections</p></div>
      <div className="cashbook-actions"><Select aria-label="Cashbook currency" value={currency} onChange={e => setCurrency(e.target.value)}>{["USD","AED","EUR","SGD"].map(c => <option key={c}>{c}</option>)}</Select>
      {writable && <Button className="primary" onClick={onAdd}><Plus size={16}/>Add entry</Button>}</div>
    </div>
    <div className="cashbook-summary">{[{name:"Income",value:totals.income,Icon:ArrowDownLeft},{name:"Expenses",value:totals.expense,Icon:ArrowUpRight},{name:"Net cash movement",value:totals.net,Icon:Wallet}].map(({name,value,Icon}) => <div key={name}><Icon size={18}/><span>{name}</span><strong>{money(value,currency)}</strong></div>)}</div>
    <div className="cashbook-filter"><Select aria-label="Cashbook entry type" value={type} onChange={e => setType(e.target.value)}>{["All entries","Income","Expense"].map(t => <option key={t}>{t}</option>)}</Select><small>Cancelled entries remain visible but are excluded from totals. Net cash movement is not profit.</small></div>
    <ListFilters {...pagination} label="entries"/>
    {pagination.total > 0 && <div className="table-scroll"><table><thead><tr><th>Description</th><th>Company</th><th>Type / Category</th><th>Transaction date</th><th>Amount</th><th>Status</th></tr></thead><tbody>{pagination.items.map(r => <tr key={r.id}><td><Button className="record-link" onClick={() => onOpen(r)}>{r.title}<small>{r.attributes?.reference || r.contact}</small></Button></td><td>{companyName(r.company)}</td><td>{r.attributes?.entryType}<small>{r.attributes?.category} · {r.attributes?.department}</small></td><td>{r.due}</td><td>{money(r.amount,r.currency)}</td><td>{r.status}</td></tr>)}</tbody></table></div>}
    {!pagination.total && !pagination.filtered && <p className="cashbook-empty">No {currency} entries yet. Add company income or an expense to get started.</p>}
    {pagination.filtered && <ListEmpty {...pagination} label="entries"/>}
    <Pagination {...pagination} label="entries"/>
  </section>;
}
