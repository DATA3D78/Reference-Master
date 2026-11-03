export function box(type,...parts){const body=Buffer.concat(parts),header=Buffer.alloc(8);header.writeUInt32BE(body.length+8);header.write(type,4);return Buffer.concat([header,body]);}
export function track(type='vide',entries=[[300,1000]]){
 const handler=Buffer.alloc(12);handler.write(type,8);
 const timing=Buffer.alloc(8+entries.length*8);timing.writeUInt32BE(entries.length,4);
 entries.forEach(([count,delta],i)=>{timing.writeUInt32BE(count,8+i*8);timing.writeUInt32BE(delta,12+i*8);});
 return box('trak',box('mdia',box('hdlr',handler),box('minf',box('stbl',box('stts',timing)))));
}
export const video=(entries=[[300,1000]])=>Buffer.concat([box('ftyp',Buffer.from('isom0000')),box('mdat',Buffer.from('Test media')),box('moov',track('soun',[[10000,1024]]),track('vide',entries))]);
