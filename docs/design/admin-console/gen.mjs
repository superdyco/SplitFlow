const dau=[118,124,131,127,142,155,149,138,145,151,147,162,171,166,152,158,164,159,173,181,176,163,169,175,172,184,193,188,177,186];
const W=630,H=180,MAX=200;
const x=i=>+((i/(dau.length-1))*W).toFixed(1);
const y=v=>+(H-(v/MAX)*H).toFixed(1);
console.log("PTS:"+dau.map((v,i)=>`${x(i)},${y(v)}`).join(" "));
console.log("AREA:M0,"+H+" L"+dau.map((v,i)=>`${x(i)},${y(v)}`).join(" L")+" L"+W+","+H+" Z");
console.log("END:",x(29),y(186));
console.log("XT:",[0,7,14,21,29].map(i=>`${i}:${x(i)}`).join(" "));
