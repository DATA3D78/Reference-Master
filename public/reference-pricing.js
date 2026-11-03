// Reference Master does not display saved estimates from other providers.
export const formatUSD=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
export function estimateReferenceCost(){return {available:false,currency:'USD',source:'comfy',statusLabel:'—',reason:'Check your Comfy account for usage and pricing.',lines:[],notes:[]};}
export function referenceBillingEstimate(){return undefined;}
