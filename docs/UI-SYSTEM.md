# Enercore interface system

The workspace uses shared React controls rather than independently styled native controls on each screen. `src/components/ui/controls.tsx` provides Button, Input, Textarea, Field, Select, DatePicker, Dialog and Tooltip. Radix primitives handle dropdown/modal focus, keyboard navigation and portals; React DayPicker supplies the calendar.

`src/app/design.css` owns typography, spacing, color, radius, shadow and motion tokens, shared component styles, and responsive layouts. Avoid page-specific resets and global table selectors: these can affect embedded calendars. The Inter variable font is bundled locally.

`src/components/sidebar.tsx` provides the expandable desktop navigation, icon-rail tooltips, collapsible groups and accessible mobile drawer. The user's desktop collapse preference is stored locally. Company and role access rules are unchanged.

Department collections share card/list presentation. Tables and pipeline boards scroll inside their panels on narrow screens. Forms use one consistent label/control/validation treatment, with custom dropdowns, calendar pickers and password visibility controls. Reduced-motion preferences disable decorative transitions.

Verification: production build and 13 existing tests passed. Browser checks covered company filtering, calendar selection, saving a fictional lead with selected company/date, desktop collapse/expand, mobile drawer, department cards, and accounts/settings layouts. At measured 388px and 582px CSS viewport widths, the checked department page had no horizontal page overflow. Browser regression specifications were updated for the custom controls; they are separate from the unit-test suite.

This is an interface update, not completion of production integrations. Database, email and external-service readiness remains described in STATUS.md and DEPLOYMENT.md.

## Dialog and theme refinement

`refinements.css` adds wide desktop dialogs (1040px, increasing to 1160px on large screens), three-column forms and four-column detail summaries. Long content and small screens retain accessible scrolling. `DialogPresence` retains closing content long enough for the Radix exit animation to finish; reduced-motion preferences remain respected.

The header's light/dark toggle saves a local preference, initially following the operating-system theme. An early theme initializer avoids a light flash during navigation. The palette covers form controls, calendars, tables, cards, dialogs, login and self-service. My Requests now renders inside the persistent `Workspace` shell with the same Sidebar, content width, preview banner, header, metrics and footer. Client-side history navigation preserves workspace filters and supports Back/Forward; direct authenticated entry at `/my-requests` uses the same shell. Navigation back to a department respects the actor's allowed modules.

Department form and detail content is defined in `record-profiles.ts` and rendered by `RecordForm`. Shared dialog styling does not imply shared business fields. IT/HR/customer screens deliberately omit sales value/quantity fields. `sales-prefill.ts` restricts saved customer and product suggestions before copying details into a quotation draft.
