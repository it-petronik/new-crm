import { test, expect } from "@playwright/test";
test("Phase 6 endpoints refuse preview without D1 or AI", async ({
  request,
}) => {
  for (const action of ["deal", "contact", "capability", "links", "customer"]) {
    const result = await request.post("/api/commercial", {
      headers: { Origin: "http://localhost:3000" },
      data: { action },
    });
    expect(result.status()).toBe(409);
  }
  expect((await request.get("/api/commercial?id=fictional")).status()).toBe(
    409,
  );
  expect(
    (
      await request.post("/api/ai/deal", {
        headers: { Origin: "http://localhost:3000" },
        data: { id: "fictional" },
      })
    ).status(),
  ).toBe(409);
});
