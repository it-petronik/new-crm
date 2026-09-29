"use client";
import { useEffect, useId, useState, type ReactNode } from "react";
import { ChevronRight, Radar, Link2 } from "lucide-react";
import type { Actor, RecordItem } from "@/lib/domain";
import { nextAction } from "@/lib/attention";
import { Button } from "../ui/controls";
import { EmptyState, Metric, Section, Tabs, tabPanelProps, useMediaQuery, type TabItem } from "../ui/layout";
import {
  CapabilitiesSection,
  CommercialFootnote,
  ContactsSection,
  DealsSection,
  LinkedRecordsSection,
  NameMatchesSection,
  PrimaryContact,
  RelatedMeetingsSection,
  openRecord,
  useCommercial,
  type Commercial,
} from "../commercial/commercial-panel";
import {
  CandidatesSection,
  FinancialSummary,
  OfferComparison,
  OfferHistorySection,
  RfqHistorySection,
  RfqSection,
  ScenarioSection,
  SelectedOffer,
  SourcingProgress,
  commercialMoney,
  sourcingState,
  useExecution,
  useExecutionHistory,
  type Execution,
} from "../commercial/execution-panel";
import { AiPanel } from "../ai/ai-answer";

/* ---------------------------------------------------------------------------
   The commercial record workspaces: Deal, Lead, Customer, Supplier, Product.

   Each has the same shape — what matters now above the tabs, then tabs for
   the areas of work, then the record's details in a context column (or at
   the end of Overview on a phone). Nothing is rendered twice and secondary
   history only renders when its tab is open.
   ------------------------------------------------------------------------ */

type Tab = "overview" | "sourcing" | "commercial" | "contacts" | "capabilities" | "offers" | "demand" | "suppliers" | "activity";

export default function CommercialWorkspace({
  record,
  actor,
  onChanged,
  details,
  activity,
  copilot,
}: {
  record: RecordItem;
  actor: Actor;
  onChanged: () => void;
  /** The record's own fields, shown as context. */
  details: ReactNode;
  /** Meetings and notes for the Activity tab. */
  activity: ReactNode;
  /** The record's Enercore AI panel, when available. */
  copilot?: ReactNode;
}) {
  const c = useCommercial(record, actor, onChanged);
  const dealId = record.kind === "leads" ? c.view?.deal?.id : undefined;
  const [tab, setTab] = useState<Tab>("overview");
  // A saved scenario is read on the Commercial tab, wherever it was started.
  const x = useExecution(dealId, onChanged, (type) => type === "scenario" && setTab("commercial"));
  const history = useExecutionHistory(record.id, ["suppliers", "products"].includes(record.kind));
  const narrow = useMediaQuery("(max-width: 960px)");
  // No room beside the tabs on a phone: the tools lead the Overview instead.
  const phone = useMediaQuery("(max-width: 640px)");
  const idBase = useId();
  // A different record starts on its overview.
  useEffect(() => setTab("overview"), [record.id]);

  const deal = record.kind === "leads" && !!dealId;
  const label =
    record.kind === "leads"
      ? deal
        ? "Deal Room"
        : "Commercial relationships"
      : record.kind === "products"
        ? "Product activity within Enercore"
        : record.kind === "suppliers"
          ? "Supplier 360"
          : "Customer 360";

  const v = x.v;
  const s = v ? sourcingState(v) : null;
  const linked = c.view?.linked || [];
  const openCount = (kinds: string[]) => linked.filter((r) => kinds.includes(r.kind)).length;
  const tabs: TabItem<Tab>[] =
    record.kind === "leads"
      ? deal
        ? [
            { id: "overview", label: "Overview" },
            { id: "sourcing", label: "Sourcing", count: v ? v.candidates.length + v.rfqs.length + (v.canSeeCosts ? s!.offers : 0) : undefined },
            { id: "commercial", label: "Commercial", count: v?.canSeeCosts ? v.scenarios.length : undefined, hidden: !!v && !v.canSeeCosts },
            { id: "activity", label: "Activity" },
          ]
        : [
            { id: "overview", label: "Overview" },
            { id: "activity", label: "Activity" },
          ]
      : record.kind === "customers"
        ? [
            { id: "overview", label: "Overview" },
            { id: "contacts", label: "Contacts", count: c.view?.contacts.length },
            { id: "commercial", label: "Commercial", count: c.view ? linked.length : undefined },
            { id: "activity", label: "Activity" },
          ]
        : record.kind === "suppliers"
          ? [
              { id: "overview", label: "Overview" },
              { id: "capabilities", label: "Capabilities", count: c.view?.capabilities.length },
              { id: "sourcing", label: "Sourcing", count: history.data?.rfqs.length },
              { id: "offers", label: "Offers", count: history.data?.offers.length },
              { id: "activity", label: "Activity" },
            ]
          : [
              { id: "overview", label: "Overview" },
              { id: "demand", label: "Demand", count: c.view ? linked.length : undefined },
              { id: "suppliers", label: "Suppliers", count: c.view?.capabilities.length },
              { id: "offers", label: "Offers", count: history.data?.offers.length },
              { id: "activity", label: "Activity" },
            ];
  const active = tabs.some((t) => t.id === tab && !t.hidden) ? tab : "overview";

  const toolbar = (
    <div className="rw-tab-tools">
      {c.writable && ["leads", "quotations"].includes(record.kind) && (
        <Button className="ghost compact" onClick={c.reviewLinks}>
          <Link2 size={14} aria-hidden="true" /> Review relationships
        </Button>
      )}
      {c.view && c.canFindProspects && (
        <Button className="ghost compact" onClick={c.findProspects}>
          <Radar size={14} aria-hidden="true" /> Find prospects
        </Button>
      )}
    </div>
  );

  let summary: ReactNode = null;
  if (record.kind === "leads" && c.view)
    summary = (
      <DealSummary record={record} c={c}>
        {deal ? (
          v ? (
            <SourcingProgress v={v} onJump={(t) => setTab(t)} />
          ) : (
            <div className="exec-skeleton" role="status" aria-label="Loading commercial activity"><span /></div>
          )
        ) : (
          <div className="deal-cta">
            <p>
              <b>No Deal Room yet.</b> Open one to source suppliers, compare offers and build the quotation.
            </p>
            <Button className="primary compact" disabled={c.busy || (!c.writable && !c.view.deal)} onClick={() => void c.openDeal()}>
              Open Deal Room
            </Button>
          </div>
        )}
      </DealSummary>
    );

  const panel = (() => {
    if (!c.view) return null;
    switch (active) {
      case "overview":
        return record.kind === "leads" ? (
          <>
            {deal && v && v.canSeeCosts && <DealCommercialState x={x} onTab={setTab} />}
            <LinkedRecordsSection c={c} title="Quotations and orders" empty="No quotation yet." limit={3} />
            {copilot}
            {deal && dealId && <AiPanel feature="deal" id={dealId} label="Brief this deal" loadingLabel="Preparing deal brief" />}
            <ContactsSection c={c} title="Customer contacts" limit={3} />
          </>
        ) : record.kind === "customers" ? (
          <>
            <Section title="Next action">
              <NextActionLine record={record} />
            </Section>
            <Section title="Primary contact" actions={c.view.contacts.length > 1 ? <Button className="ghost compact" onClick={() => setTab("contacts")}>All {c.view.contacts.length} contacts <ChevronRight size={14} aria-hidden="true" /></Button> : undefined}>
              <PrimaryContact c={c} />
            </Section>
            <LinkedRecordsSection c={c} title="Open leads and deals" only={["leads"]} open empty="No open leads." limit={5} />
            <LinkedRecordsSection c={c} title="Latest quotations and orders" only={["quotations", "orders"]} empty="No quotations or orders yet." limit={3} />
            {copilot}
          </>
        ) : record.kind === "suppliers" ? (
          <>
            <div className="ui-metrics">
              <Metric label="Capabilities" value={c.view.capabilities.length} detail="Recorded products" onClick={() => setTab("capabilities")} />
              <Metric
                label="Open requests"
                value={history.data ? history.data.rfqs.filter((r) => !["Closed", "Responded"].includes(r.status)).length : "—"}
                detail={history.data ? `${history.data.rfqs.length} in total` : undefined}
                onClick={() => setTab("sourcing")}
              />
              <Metric label="Offers" value={history.data ? history.data.offers.length : "—"} detail="Recorded BUY offers" onClick={() => setTab("offers")} />
            </div>
            {history.data?.offers[0] && (
              <Section title="Latest offer">
                <LatestOffer o={history.data.offers[0]} />
              </Section>
            )}
            <ContactsSection c={c} />
          </>
        ) : (
          <>
            <div className="ui-metrics">
              <Metric
                label="Open demand"
                value={linked.filter((r) => r.kind === "leads" && !["Won", "Lost"].includes(r.status)).length}
                detail={`${openCount(["quotations"])} quotations · ${openCount(["orders"])} orders`}
                onClick={() => setTab("demand")}
              />
              <Metric label="Capable suppliers" value={new Set(c.view.capabilities.map((x) => x.supplierId)).size} detail="Recorded capability" onClick={() => setTab("suppliers")} />
              <Metric label="Supplier offers" value={history.data ? history.data.offers.length : "—"} detail="Internal BUY history" onClick={() => setTab("offers")} />
            </div>
            <LinkedRecordsSection c={c} title="Active demand" open empty="No open leads, quotations or orders for this product." limit={5} />
          </>
        );
      case "sourcing":
        return record.kind === "leads" ? (
          v ? (
            <>
              <CandidatesSection x={x} />
              <RfqSection x={x} />
              <OfferComparison x={x} />
              <CapabilitiesSection c={c} collapsed />
              <p className="exec-caption">{v.coverage}</p>
            </>
          ) : (
            <div className="exec-skeleton" role="status" aria-label="Loading commercial activity"><span /><span /><span /></div>
          )
        ) : (
          <>
            <RfqHistorySection data={history.data} />
            <DealsSection c={c} />
          </>
        );
      case "commercial":
        return record.kind === "leads" ? (
          <>
            <SelectedOffer x={x} onSourcing={() => setTab("sourcing")} />
            <ScenarioSection x={x} />
            <LinkedRecordsSection c={c} title="Quotations and orders" empty="No quotation yet." />
          </>
        ) : (
          <>
            <LinkedRecordsSection c={c} title="Leads, quotations and orders" empty="No linked commercial records yet. Link this company when recording an enquiry." />
            <DealsSection c={c} />
            <NameMatchesSection c={c} />
          </>
        );
      case "contacts":
        return <ContactsSection c={c} />;
      case "capabilities":
      case "suppliers":
        return <CapabilitiesSection c={c} />;
      case "offers":
        return (
          <>
            <OfferHistorySection data={history.data} error={history.error} />
            {record.kind === "products" && <RfqHistorySection data={history.data} />}
          </>
        );
      case "demand":
        return (
          <>
            <LinkedRecordsSection c={c} title="Leads, quotations and orders" empty="No linked commercial records yet. Link this product when recording an enquiry." />
            <DealsSection c={c} />
          </>
        );
      case "activity":
        return (
          <>
            {activity}
            <RelatedMeetingsSection c={c} />
            <CommercialFootnote />
          </>
        );
    }
  })();

  const aside = active === "overview";
  return (
    <div className="rw-commercial" role="region" aria-label={label} aria-busy={c.loading || x.busy}>
      {c.error && (
        <p className="form-error" role="alert">
          {c.error}
        </p>
      )}
      {x.error && (
        <p className="form-error" role="alert">
          {x.error}
        </p>
      )}
      {!c.view && c.loading && (
        <div className="commercial-skeleton" role="status" aria-label="Loading commercial relationships">
          <span />
          <span />
          <span />
        </div>
      )}
      {summary}
      <div className="rw-tabbar">
        <Tabs items={tabs} active={active} onChange={setTab} label={`${label} sections`} idBase={idBase} />
        {!phone && toolbar}
      </div>
      <div className={`rw-body${aside && !narrow ? " has-aside" : ""}`}>
        <div className="rw-main" {...tabPanelProps(idBase, active)}>
          {phone && active === "overview" && toolbar}
          {panel}
          {aside && narrow && <Section title="Details" className="rw-details-inline">{details}</Section>}
        </div>
        {aside && !narrow && <aside className="rw-context" aria-label="Details">{details}</aside>}
      </div>
      {c.editorsNode}
      {x.editorNode}
    </div>
  );
}

/** Who, what and what next — the few facts a salesperson needs first. */
function DealSummary({ record, c, children }: { record: RecordItem; c: Commercial; children?: ReactNode }) {
  const view = c.view!;
  const contact = view.contacts.find((p) => p.id === record.contactId);
  const requirement = [
    record.product || "Product not set",
    record.quantity ? `${record.quantity.toLocaleString("en-US")} ${record.unit}` : "",
    record.destination && `to ${record.destination}`,
    record.attributes?.incoterm,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <section className="deal-summary" aria-label="Deal summary">
      <dl className="deal-facts">
        <div>
          <dt>Customer</dt>
          <dd>
            {view.customer ? (
              <Button className="record-link" onClick={() => openRecord(view.customer!)}>
                {view.customer.title}
              </Button>
            ) : (
              "Not linked to a customer"
            )}
          </dd>
        </div>
        <div>
          <dt>Contact</dt>
          <dd>{contact ? [contact.name, contact.role].filter(Boolean).join(" · ") : "No contact selected"}</dd>
        </div>
        <div className="is-wide">
          <dt>Requirement</dt>
          <dd>{requirement}</dd>
        </div>
        <div>
          <dt>Next action</dt>
          <dd>
            <NextActionLine record={record} />
          </dd>
        </div>
      </dl>
      {children}
    </section>
  );
}

function NextActionLine({ record }: { record: RecordItem }) {
  const a = nextAction(record);
  return (
    <span className={`next-action tone-${a.tone}`}>
      {a.label}
      {record.due && !a.label.includes(record.due) && !/^No /.test(a.label) ? ` · ${record.due}` : ""}
    </span>
  );
}

/** The commercial state on the Deal overview: the selected scenario, or where to go next. */
function DealCommercialState({ x, onTab }: { x: Execution; onTab: (t: Tab) => void }) {
  const v = x.v!;
  const s = sourcingState(v);
  const scenario = s.selectedScenario || [...v.scenarios].find((sc) => sc.status === "Reviewed");
  return (
    <Section
      title="Commercial state"
      actions={
        <Button className="ghost compact" onClick={() => onTab("commercial")}>
          Open commercial <ChevronRight size={14} aria-hidden="true" />
        </Button>
      }
    >
      {scenario ? (
        <FinancialSummary s={scenario} offer={v.offers.find((o) => o.id === scenario.offerId)} />
      ) : (
        <EmptyState
          title={s.offers ? `${s.offers} ${s.offers === 1 ? "offer" : "offers"} received, no scenario reviewed yet.` : "No supplier offers yet."}
          detail={s.offers ? "Create a scenario from an offer to see landed cost, SELL and margin." : "Prepare RFQs from the supplier candidates on the Sourcing tab."}
          action={
            <Button className="secondary compact" onClick={() => onTab(s.offers ? "sourcing" : "sourcing")}>
              Go to sourcing
            </Button>
          }
        />
      )}
    </Section>
  );
}

function LatestOffer({ o }: { o: NonNullable<ReturnType<typeof useExecutionHistory>["data"]>["offers"][number] }) {
  return (
    <div className="selected-offer">
      <div>
        <p className="selected-offer-name">
          {o.product} <span className="exec-revision">· revision {o.revision}</span>
        </p>
        <p className="exec-meta">{[o.details.incoterm, o.details.paymentTerms, o.validity].filter(Boolean).join(" · ")}</p>
      </div>
      <p className="selected-offer-price">
        <span className="e-numeric">{commercialMoney(o.details.price, o.details.currency)}</span>
        <small> / {o.details.priceUnit}</small>
      </p>
    </div>
  );
}
