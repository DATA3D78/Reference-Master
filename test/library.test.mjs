import {test} from 'node:test';
import assert from 'node:assert/strict';
import {historyRange,inHistoryPeriod} from '../public/library.js';

test('history calendar ranges include their start and exclude their end',()=>{
  const now=new Date(2026,9,8,15,30);
  for(const [period,start,end] of [['day',new Date(2026,9,8),new Date(2026,9,9)],['week',new Date(2026,9,5),new Date(2026,9,12)],['month',new Date(2026,9,1),new Date(2026,10,1)]]){
    assert.deepEqual(historyRange(period,now),{start,end});
    assert(inHistoryPeriod(start.toISOString(),period,now));
    assert(!inHistoryPeriod(new Date(start-1).toISOString(),period,now));
    assert(inHistoryPeriod(new Date(end-1).toISOString(),period,now));
    assert(!inHistoryPeriod(end.toISOString(),period,now));
  }
  assert(inHistoryPeriod('2020-01-01','all',now));assert.equal(historyRange('all',now),null);
});
test('weeks, months and daylight saving changes follow the local calendar',()=>{
  const previous=process.env.TZ;process.env.TZ='America/New_York';
  try{
    const spring=historyRange('day',new Date(2026,2,8,12)),fall=historyRange('day',new Date(2026,10,1,12));
    assert.equal(spring.end-spring.start,23*3600000);assert.equal(fall.end-fall.start,25*3600000);
    assert.equal(historyRange('week',new Date(2027,0,3)).start.getFullYear(),2026);
    assert.equal(historyRange('week',new Date(2027,0,3)).end.getDate(),4);
    assert.equal(historyRange('month',new Date(2026,11,31)).end.getFullYear(),2027);
  }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});
