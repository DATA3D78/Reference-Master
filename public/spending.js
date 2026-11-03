const $=selector=>document.querySelector(selector);
const periods={day:'Today',week:'This week',month:'This month',year:'This year'};
const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:value>0&&value<.01?6:2}).format(value);
export class SpendingMeter{
  constructor({api,post}){
    this.api=api;this.post=post;this.year=new Date().getFullYear();this.yearVersion=0;this.version=0;this.checking=false;
    try{this.period=localStorage.getItem('fwrd-spending-period');}catch{}
    if(!periods[this.period])this.period='day';
    $('#spending-period').value=this.period;
    const calendar=document.createElement('section');calendar.className='spending-calendar';calendar.innerHTML='<div class="label-row"><h3>Monthly spending</h3><label>Year <input id="spending-year" type="number" min="2000" max="'+this.year+'" value="'+this.year+'" aria-label="Spending year"></label></div><div id="spending-months" class="spending-months"></div><p id="spending-year-total" class="hint" aria-live="polite"></p>';$('#spending-breakdown').before(calendar);
    $('#spending-year').onchange=()=>{const year=Number($('#spending-year').value);if(!Number.isInteger(year)||year<2000||year>new Date().getFullYear())return;this.year=year;void this.refreshYear();};
    $('#spending-period').addEventListener('change',()=>{
      this.period=$('#spending-period').value;this.data=null;this.lastCheck=0;this.version++;
      try{localStorage.setItem('fwrd-spending-period',this.period);}catch{}
      $('#spending-amount').textContent='…';$('#spending-caption').textContent='Loading';void this.refresh(true);
    });
    $('#spending-open').addEventListener('click',()=>{$('#spending-dialog').showModal();void this.refresh(true);void this.refreshYear();});
    $('#spending-close').addEventListener('click',()=>$('#spending-dialog').close());
    $('#spending-sync').addEventListener('click',()=>void this.sync());
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)void this.refresh(true);});
    this.timer=setInterval(()=>{if(!document.hidden)void this.refresh(true);},10000);
    void this.refresh(true);
  }
  async refresh(check=false){
    const version=++this.version,period=this.period;
    try{
      const data=await this.api('/api/spending?period='+period);
      if(version!==this.version)return;this.data=data;this.offline=false;this.render();if($('#spending-dialog').open)void this.refreshYear();
      if(check&&Date.now()-(this.lastCheck||0)>300000)void this.sync();
    }catch{
      if(version!==this.version)return;this.offline=true;this.render();
    }
  }
  async sync(){
    if(this.checking)return;this.checking=true;this.lastCheck=Date.now();this.render();
    const period=this.period;
    try{
      const data=await this.post('/api/spending/sync',{period});
      if(period===this.period){this.version++;this.data=data;this.offline=false;}
    }catch{if(period===this.period)this.offline=true;}
    finally{this.checking=false;this.render();if($('#spending-dialog').open)void this.refreshYear();if(period!==this.period){this.lastCheck=0;void this.refresh(true);}}
  }
  async refreshYear(){const version=++this.yearVersion;try{const data=await this.api('/api/spending/year?year='+this.year);if(version!==this.yearVersion)return;$('#spending-months').replaceChildren(...data.months.map(m=>{const card=document.createElement('div');card.className='spending-month';const label=document.createElement('span'),value=document.createElement('strong'),note=document.createElement('small');label.textContent=new Date(data.year,m.month-1,1).toLocaleDateString('en-US',{month:'long'});value.textContent=m.future?'—':(!m.confirmedCount&&!m.estimatedCount&&m.unpriced?'—':(m.estimatedCount?'≈':'')+money(m.total))+(m.unpriced?' +':'');note.textContent=m.future?'Upcoming':m.unpriced?'Incomplete':m.pending?'Processing':m.estimatedCount?'Includes estimates':m.confirmedCount?'Confirmed':'No recorded charges';card.append(label,value,note);card.title=money(m.confirmed)+' confirmed · '+money(m.estimated)+' estimated · '+m.unpriced+' unpriced · '+m.pending+' processing';return card;}));$('#spending-year-total').textContent=data.year+' total: '+(data.months.some(m=>m.estimatedCount)?'≈':'')+money(data.total)+(data.months.some(m=>m.unpriced)?' +':'')+' · All projects · '+data.timezone;}catch{if(version===this.yearVersion)$('#spending-year-total').textContent='Monthly spending unavailable. Try refreshing charges.';}}
  render(){
    const d=this.data,caption=$('#spending-caption'),amount=$('#spending-amount');
    $('#spending-sync').disabled=this.checking;$('#spending-sync').textContent=this.checking?'Checking…':'Refresh charges';
    if(!d){amount.textContent='—';caption.textContent=this.offline?'Unavailable':'Loading';$('#spending-summary').textContent=this.offline?'Could not reach the local server. Reopen the launcher, then refresh charges.':'Loading spending…';return;}
    const hasAmount=d.confirmedCount+d.estimatedCount>0;
    amount.textContent=(!hasAmount&&d.unpriced?'—':(d.estimatedCount?'≈':'')+money(d.total))+(hasAmount&&d.unpriced?' +':'');
    caption.textContent=this.offline?'Offline · saved total':d.unpriced?'Partial · USD':d.estimatedCount?'Estimated · USD':'Spent · USD';
    $('#spending-open').title='Spending across all projects. '+(d.estimatedCount?'Includes estimates. ':'')+(d.unpriced?'Some charges are unavailable. ':'')+'View breakdown';
    $('#spending-open').setAttribute('aria-label',periods[this.period]+' spending '+amount.textContent+'. '+caption.textContent+'. View breakdown');
    $('#spending-detail-period').textContent=periods[this.period];
    $('#spending-detail-total').textContent=amount.textContent;
    const options={month:'short',day:'numeric',year:'numeric',timeZone:d.timezone};
    $('#spending-range').textContent=new Date(d.start).toLocaleDateString(undefined,options)+' – '+new Date(d.end).toLocaleDateString(undefined,options)+' · '+d.timezone;
    $('#spending-summary').textContent=this.offline?'Showing the last total received. The local server is unavailable.':d.unpriced?`${d.unpriced} request${d.unpriced===1?' has':'s have'} no confirmed cost yet; the total is incomplete.`:d.estimatedCount?`${d.estimatedCount} completed request${d.estimatedCount===1?' uses':'s use'} estimated pricing. Actual charges and discounts may differ.`:hasAmount?'Confirmed charges returned by your API providers.':'No recorded charges for this period.';
    $('#spending-breakdown').replaceChildren(...Object.entries(d.providers).filter(([provider,p])=>provider!=='comfy'||p.confirmedCount+p.estimatedCount+p.unpriced+p.pending>0).map(([provider,p])=>{
      const row=document.createElement('div');row.className='spending-provider';
      const label=document.createElement('div'),name=document.createElement('strong'),detail=document.createElement('small'),price=document.createElement('strong');
      name.textContent=provider==='comfy'?'Comfy Router':provider==='fal'?'fal.ai':'OpenRouter';
      detail.textContent=provider==='comfy'?'Earlier Comfy generations':provider==='fal'?'Images, video, audio & tools':'LLM & prompt enhancement';label.append(name,detail);
      price.textContent=(p.estimatedCount?'≈':'')+money(p.total)+(p.unpriced?' +':'');row.append(label,price);
      const costs=document.createElement('p');costs.textContent=`${money(p.confirmed)} confirmed`+(p.estimatedCount?` · ${money(p.estimated)} estimated`:'')+(p.unpriced?` · ${p.unpriced} unpriced`:'');if(p.referenceCount)costs.textContent+=` · ${p.referenceCount} at published reference rates`;row.append(costs);return row;
    }));
    $('#spending-pending').hidden=!d.pending;$('#spending-pending').textContent=`${d.pending} request${d.pending===1?' is':'s are'} still processing. Charges will appear when available.`;
    $('#spending-extra').hidden=!d.extraUsage;
    $('#spending-storage').hidden=!d.storageError;
    const notice=[d.referenceCount?'Estimates use published rates. Final provider charges may differ; older Comfy history keeps its original provider.':'',d.notice].filter(Boolean).join(' ');$('#spending-notice').textContent=notice;$('#spending-notice').hidden=!notice;
    $('#spending-tracking').textContent='Saved generations from all projects are included. Prompt enhancement tracking began '+new Date(d.trackingStartedAt).toLocaleDateString(undefined,options)+'. Earlier enhancements were not recorded.';
    $('#spending-checked').textContent=d.lastSync?'Billing checked '+new Date(d.lastSync).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}):'Charges update automatically while this studio is open.';
  }
}
