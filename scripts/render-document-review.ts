/** Local PDF QA renderer. Input is a fictional RecordItem on stdin; output is
 * HTML only. Separate Node rendering avoids Playwright's JSX object transform. */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QuotationDocument } from "../src/components/quotation-document";
import type { RecordItem } from "../src/lib/domain";
const record = JSON.parse(readFileSync(0, "utf8")) as RecordItem;
process.stdout.write(
  renderToStaticMarkup(
    createElement(QuotationDocument, { record, connected: true }),
  ),
);
