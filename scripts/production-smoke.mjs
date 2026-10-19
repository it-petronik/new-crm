// Read-only production smoke. No login attempts, live records or provider calls.
import assert from "node:assert/strict";
import {chromium} from "playwright";
const origin="https://crm.enercore.ae",checks=[];
for(const path of ["/api/records","/api/users","/api/tasks","/api/operations","/api/outbound","/api/mail","/api/mail/connection","/api/collab/conversations"]){
 const response=await fetch(origin+path,{redirect:"manual"});assert.equal(response.status,path==="/api/users"?403:401,`${path} must deny anonymous access`);checks.push({path,status:response.status});
}
for(const path of ["/__test/automation-sweep","/__test/mailbox-sweep"]){
 const response=await fetch(origin+path,{method:"POST",redirect:"manual"});assert.equal(response.status,404,`${path} must not exist in production`);checks.push({path,status:response.status});
}
const login=await fetch(origin+"/login");assert.equal(login.status,200);assert.match(login.headers.get("content-security-policy"),/img-src 'self' data: blob:/);assert.equal(login.headers.get("x-frame-options"),"DENY");
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto(origin+"/login",{waitUntil:"networkidle"});await page.locator('input[name="email"]').waitFor();await page.locator('input[type="password"]').waitFor();
 assert.equal(await page.locator('input[type="password"]').count(),1);assert.deepEqual(errors,[]);
 for(const width of [390,1440]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:`test-results/phase11-live-login-${width}.png`});}
 console.log(JSON.stringify({status:"passed",origin,anonymousApiChecks:checks,loginRenders:true,noBrowserErrors:true,viewports:[390,1440],authenticatedLiveAcceptance:"Requires existing team credentials; not performed"}));
}finally{await browser.close();}
