import { type Kind } from "./domain";
export function activityProfile(kind: Kind) {
  return (
    {
      leads: {
        title: "Sales follow-ups",
        label: "Call, email or meeting outcome",
        action: "Log follow-up",
      },
      logistics: {
        title: "Shipment updates",
        label: "Delivery progress or exception",
        action: "Add shipment update",
      },
      it: {
        title: "Support progress",
        label: "Troubleshooting or resolution",
        action: "Add support update",
      },
      orders: {
        title: "Order updates",
        label: "Fulfilment update",
        action: "Add order update",
      },
    } as Partial<Record<Kind, { title: string; label: string; action: string }>>
  )[kind];
}
