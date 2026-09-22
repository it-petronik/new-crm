import {test} from "node:test";
import assert from "node:assert/strict";
import {workspaceUrl,workspaceParams} from "../src/lib/workspace-url";
test("friendly workspace paths round-trip company and page",()=>{
  for(const company of ["All companies","Petronik","Afrilube","Petronex","Istanegry"]){
    for(const page of ["overview","leads","orders","access","my-requests"]){
      const path=workspaceUrl(page,company), params=workspaceParams(path,"");
      assert.equal(params.get("company"),company);
      assert.equal(params.get(page === "access" ? "view":"module"),page);
      assert.ok(!path.includes("?")&&!path.includes("%20"));
    }
  }
  assert.equal(workspaceParams("/","?module=leads").get("module"),"leads");
});
