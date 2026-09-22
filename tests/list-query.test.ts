import {test} from "node:test";
import assert from "node:assert/strict";
import {queryList,emptyQuery} from "../src/lib/list-query";
import {salaryAttributes} from "../src/lib/salary";
test("list filters combine status dates search and sorting without mutation",()=>{
 const rows=[{id:"1",title:"Zulu",status:"Active",amount:20,createdAt:"2026-09-01"},{id:"2",title:"Alpha",status:"Active",amount:10,createdAt:"2026-09-02"}];
 assert.equal(queryList(rows,{...emptyQuery,sort:"name"})[0].id,"2");
 assert.equal(queryList(rows,{...emptyQuery,status:"Active",search:"alpha"}).length,1);
 assert.equal(rows[0].id,"1");
 assert.equal(queryList(rows,{...emptyQuery,status:"Inactive"}).length,0);
});
test("salary total is derived and invalid amounts rejected",()=>{
 assert.equal(salaryAttributes({basicSalary:"5000",allowance:"750.50",monthlySalary:"1"}).monthlySalary,"5750.5");
 assert.equal(salaryAttributes({monthlySalary:"5000"}).monthlySalary,"5000");
 assert.throws(()=>salaryAttributes({basicSalary:"-1"}));
});
