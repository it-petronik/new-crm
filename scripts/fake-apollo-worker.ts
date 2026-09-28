// Local test named entrypoint only. Never added to a production binding.
import { WorkerEntrypoint } from "cloudflare:workers";
import { FixtureApollo } from "../tests/support/fake-apollo";
import { ApolloError } from "../src/lib/prospecting/provider";
import { CommercialError } from "../src/lib/commercial/model";
export class FakeApollo extends WorkerEntrypoint {
  async fetch(request: Request) {
    try {
      const p = new FixtureApollo();
      const body = await request.json();
      return Response.json(
        new URL(request.url).pathname === "/account"
          ? await p.account()
          : new URL(request.url).pathname === "/bulk"
            ? await p.bulk(body.prospects, body.phones)
            : new URL(request.url).pathname === "/phone"
              ? await p.phoneResult()
              : new URL(request.url).pathname === "/search"
                ? await p.search(body)
                : await p.enrich(body),
      );
    } catch (e) {
      return Response.json(
        {
          retryAfter: e instanceof ApolloError ? e.retryAfter : undefined,
          uncertain: e instanceof ApolloError ? e.uncertain : undefined,
          error:
            e instanceof CommercialError
              ? e.message
              : "Fictional provider error",
        },
        { status: e instanceof CommercialError ? e.status : 503 },
      );
    }
  }
}
