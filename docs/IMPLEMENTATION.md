# Enercore implementation plan

1. Scaffold Next.js and a navy/teal responsive design system; build executive overview and department workspaces.
2. Implement shared domain types, company/branch permissions and connected quote/order/shipment/invoice transitions.
3. Add MySQL/Prisma persistence, individual credential authentication, server-side authorization, audit events and guarded APIs.
4. Build functional forms, filters, detail panels, approval queues and employee self-service. Keep a clearly marked fictional preview independent of production.
5. Verify type safety, production build, permission rules, monetary calculations and UI interactions.

Initial repository was empty. No existing application or database was connected. Production migration, deployment and outbound messages require the user's explicit authorization. Preview data must never be represented as real company performance.

Design: dark ink sidebar, warm off-white workspace, teal primary actions, restrained gradients, spacious cards and clear hierarchy. Mobile navigation and reduced-motion support. Screens emphasize next actions over data entry.
