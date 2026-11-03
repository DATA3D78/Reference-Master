export function pricePreview(post,paint){
 let timer,revision=0;
 return {show(value){++revision;clearTimeout(timer);paint(value);},update(body,{enabled=true,reason='Choose generation settings to see an estimate.',fallback}={}){
  const current=++revision;clearTimeout(timer);paint(fallback||{available:false,statusLabel:enabled?'…':'—',reason:enabled?'Calculating the Comfy Router estimate.':reason});
  if(!enabled)return;
  timer=setTimeout(async()=>{try{const estimate=await post('/api/estimate',body);if(current===revision)paint(estimate.available?estimate:fallback||estimate);}catch(error){if(current===revision)paint(fallback||{available:false,statusLabel:'—',reason:error.message});}},650);
 }};
}
export function priceText(value){
 if(!value?.available)return value?.statusLabel||'—';
 const format=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:4}).format(n);
 return (value.approximate?'≈':'')+(value.minimum===value.maximum?format(value.minimum):format(value.minimum)+'–'+format(value.maximum))+(value.extraUsage?' +':'');
}
export function priceLabel(value){return 'Estimated total · USD';}
