import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calendarDays,contentError} from '../src/lib/content-calendar';
const plan = {kind:'marketing' as const,title:'Product spotlight',product:'Instagram',due:'2026-10-03',detail:'Caption',attributes:{contentType:'social-post',contentStage:'Draft',contentFormat:'Image',contentTimezone:'Asia/Dubai',contentTime:'09:30',contentAsset:'https://example.com/design'}};
test('content calendar uses Monday start and handles leap years',()=>{assert.equal(calendarDays('2026-10')[3],'2026-10-01');assert.equal(calendarDays('2024-02').filter(Boolean).length,29);assert.equal(calendarDays('2026-02').filter(Boolean).length,28);});
test('post plans validate channels, dates, times and safe asset links',()=>{assert.equal(contentError(plan),'');for(const bad of [{...plan,due:'2026-02-30'},{...plan,product:'Invalid'},{...plan,attributes:{...plan.attributes,contentTime:'25:00'}},{...plan,attributes:{...plan.attributes,contentAsset:'javascript:alert(1)'}},{...plan,attributes:{...plan.attributes,contentStage:'Sent automatically'}}]) assert.notEqual(contentError(bad),'');});
test('ordinary campaigns remain unaffected',()=>{assert.equal(contentError({...plan,attributes:{}}),'');});
