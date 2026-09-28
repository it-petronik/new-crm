const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { buildSync } = require("esbuild");
const { Miniflare, convertV4MiniflareOptions } = require("miniflare");
test("Cloudflare workerd accepts the actual provider options and never follows redirects or forwards a key", async () => {
  const script = buildSync({
    stdin: {
      contents: `import {RealApollo} from './src/lib/prospecting/provider';
      import {searchInput} from './src/lib/prospecting/model';
      export default {async fetch(request){
        const keywords=new URL(request.url).pathname==='/redirect'?'redirect':'success';
        try {const page=await new RealApollo('fictional-runtime-only').search(searchInput.parse({kind:'company',keywords}));return Response.json({ok:true,count:page.prospects.length});}
        catch(e){return Response.json({ok:false,message:e.message,uncertain:e.uncertain});}
      }}`,
      resolveDir: path.resolve(__dirname, ".."),
      sourcefile: "apollo-runtime-fixture.ts",
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    conditions: ["worker", "browser"],
    external: ["node:*", "@opennextjs/cloudflare"],
    logLevel: "silent",
  }).outputFiles[0].text;
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "provider",
          modules: true,
          compatibilityDate: "2026-09-01",
          compatibilityFlags: ["nodejs_compat"],
          outboundService: "mock",
          script,
        },
        {
          name: "mock",
          modules: true,
          compatibilityDate: "2026-09-01",
          script: `let calls=[];export default {async fetch(request){
      const u=new URL(request.url);
      if(u.hostname==='test-control'&&u.pathname==='/stats')return Response.json(calls);
      calls.push({origin:u.origin,keyPresent:request.headers.has('x-api-key')});
      if(u.hostname!=='api.apollo.io')return Response.json({unexpectedDestination:true});
      const body=await request.json();
      return body.q_organization_keyword_tags?.includes('redirect')?new Response(null,{status:307,headers:{Location:'https://redirect-destination.test/capture'}}):Response.json({organizations:[{id:'fictional-runtime-company',name:'Fictional company'}]});
    }}`,
        },
      ],
    }),
  );
  try {
    assert.deepEqual(
      await (await mf.dispatchFetch("http://localhost/success")).json(),
      { ok: true, count: 1 },
    );
    const result = await (
      await mf.dispatchFetch("http://localhost/redirect")
    ).json();
    assert.equal(result.ok, false);
    assert.equal(result.uncertain, true);
    assert.match(result.message, /not followed/);
    const outbound = await mf.getWorker("mock");
    const calls = await (
      await outbound.fetch("https://test-control/stats")
    ).json();
    assert.deepEqual(calls, [
      { origin: "https://api.apollo.io", keyPresent: true },
      { origin: "https://api.apollo.io", keyPresent: true },
    ]);
    assert.equal(
      calls.filter((x) => x.origin !== "https://api.apollo.io").length,
      0,
    );
  } finally {
    await mf.dispose();
  }
});
