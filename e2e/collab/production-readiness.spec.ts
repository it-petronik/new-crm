import {test,expect} from "@playwright/test";
import {Client} from "./client";
import {people} from "./people";
import {allowedModules,canRead,canManageUsers,type Actor} from "../../src/lib/domain";
import {workspaceUrl} from "../../src/lib/workspace-url";
import {operationsAccess} from "../../src/lib/operations/model";

for(const person of people.filter(p=>p.key.startsWith("release"))){
 test(`${person.role}: permitted pages and server company/role boundaries`,async({browser})=>{
  const client=await Client.login(person.key),actor:Actor={...person,role:person.role as Actor["role"]};
  const records=await client.request("GET","/api/records");expect(records.status).toBe(200);
  for(const record of records.body.records){expect(record.company).toBe("Petronik");expect(canRead(actor,record)).toBe(true);}
  const users=await client.request("GET","/api/users");expect(users.status).toBe(canManageUsers(actor)?200:403);
  const operations=await client.request("GET","/api/operations?company=Petronik");expect(operations.status).toBe(operationsAccess(actor).view?200:403);
  const context=await browser.newContext({viewport:{width:1440,height:900}});await client.signInBrowser(context);const page=await context.newPage(),errors:string[]=[];
  page.on("pageerror",e=>errors.push(e.message));
  const routes=allowedModules(actor).map(module=>workspaceUrl(module,"Petronik"));
  if(person.role==="MD")for(const view of ["mail","prospecting","collaboration","ai","actions","tasks","operations","notifications","profile","appearance","access","shortcuts"])routes.push(workspaceUrl(view,"Petronik"));
  for(const route of routes){const response=await page.goto(route);expect(response?.status(),route).toBeLessThan(400);await expect(page.locator("#main")).toBeVisible();await expect(page.locator("#main")).not.toContainText(/Application error:|Internal Server Error|This page could not be found/);}
  expect(errors).toEqual([]);await context.close();
 });
}
