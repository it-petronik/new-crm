import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scopedWorkspace,outstanding} from '../src/lib/domain';
import {makePreview,previewActor} from '../src/lib/fixtures';
import {transition,addNote,recordPayment} from '../src/lib/workflow';
test('partial payment reduces balance and duplicate references are rejected',()=>{const data=makePreview();const r=data.records.find(r=>r.kind==='accounts'&&r.status==='Sent')!;const next=recordPayment(data,previewActor,r.id,10000,'BANK-TEST-001');const invoice=next.records.find(i=>i.id===r.id)!;assert.equal(invoice.status,'Partially Paid');assert.equal(outstanding(invoice),r.amount-100);assert.throws(()=>recordPayment(next,previewActor,r.id,10000,'BANK-TEST-001'),/already/);assert.throws(()=>recordPayment(next,previewActor,r.id,1e12,'BANK-TEST-002'),/exceed/);});
test('payment states cannot be set directly',()=>{const data=makePreview();const r=data.records.find(r=>r.kind==='accounts')!;assert.throws(()=>transition(data,previewActor,r.id,'Paid'),/Record a payment/);});
test('follow-ups persist notes and date with an audit entry',()=>{const data=makePreview();const r=data.records[0];const next=addNote(data,previewActor,r.id,'Called buyer. Requested revised terms.','2026-10-01');const lead=next.records.find(x=>x.id===r.id)!;assert.equal(lead.due,'2026-10-01');assert.equal(lead.notes?.length,1);assert.equal(next.audit.length,data.audit.length+1);});
test('audit metadata does not cross branch or department scopes',()=>{const data=makePreview();const actor={...previewActor,role:'Branch Manager' as const,branches:['Other']};assert.equal(scopedWorkspace(actor,data).audit.length,0);const it={...previewActor,role:'IT Administrator' as const};assert.equal(scopedWorkspace(it,data).audit.length,0);});
