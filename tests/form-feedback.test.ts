import test from "node:test";
import assert from "node:assert/strict";
import { controlFeedback } from "../src/lib/form-feedback";
import { brandMarks, brandMarkFor } from "../src/lib/brand-marks";
const valid={valueMissing:false,typeMismatch:false,patternMismatch:false,rangeUnderflow:false,rangeOverflow:false,stepMismatch:false,badInput:false,tooLong:false,customError:false};
test("shared form feedback names required fields without native browser messages",()=>{
  assert.equal(controlFeedback("Employee *","",{...valid,valueMissing:true}),"Employee is required.");
  assert.equal(controlFeedback("Email","bad",{...valid,typeMismatch:true}),"Enter a valid email address, like name@company.com.");
  assert.equal(controlFeedback("Quantity","-1",{...valid,rangeUnderflow:true},{min:"0"}),"Quantity must be at least 0.");
  assert.equal(controlFeedback("Quantity","2.5",valid),"");
  assert.equal(controlFeedback("Optional note","",valid),"");
});
test("symbol crops retain artwork bounds and never include wordmark regions",()=>{
  for(const mark of Object.values(brandMarks)){
    const [x,y,w,h]=mark.crop;
    assert.ok(w>0&&h>0&&x>=0&&y>=0);
    assert.ok(x+w<=mark.width&&y+h<=mark.height);
    assert.equal(brandMarkFor(mark.src),mark);
  }
  assert.equal(brandMarkFor("/brands/enercore-lockup-white.svg"),brandMarks.Enercore);
  assert.equal(brandMarkFor("/customer-approved-custom-logo.png"),undefined);
});
