import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeSpendingYear} from '../spending-store.mjs';
test('annual calendar groups all twelve local months and preserves billing uncertainty',()=>{
 const entry=(id,month,other)=>({id,provider:'fal',createdAt:new Date(2026,month,1).toISOString(),status:'COMPLETED',...other});
 const entries=[entry('jan',0,{actual:2}),entry('feb',1,{estimate:{amount:3}}),entry('unknown',1,{}),entry('future',11,{actual:100}),{...entry('old',0,{actual:50}),createdAt:new Date(2025,11,31).toISOString()}];
 const result=summarizeSpendingYear(entries,2026,new Date(2026,10,1,12));assert.equal(result.months.length,12);assert.equal(result.total,5);assert.equal(result.months[0].confirmed,2);assert.equal(result.months[1].estimated,3);assert.equal(result.months[1].unpriced,1);assert.equal(result.months[11].future,true);assert.equal(result.months[11].total,0);assert.equal(summarizeSpendingYear(entries,2025,new Date(2026,10,1)).total,50);assert.throws(()=>summarizeSpendingYear(entries,2027,new Date(2026,10,1)));
});
