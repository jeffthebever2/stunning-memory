const maximumFrame = 8 * 1024 * 1024;
export function validateHostedFrame(value) {
  if(value?.v!==1||!Array.isArray(value.events)||typeof value.status!=='string')throw new Error('Invalid hosted stream frame');
  for(const event of value.events)if(!event||typeof event.id!=='string'||!/^(0|[1-9][0-9]{0,18})$/.test(event.id)||typeof event.kind!=='string')throw new Error('Invalid hosted stream event');
  const p=value.preview;
  if(p!==undefined&&(!p||typeof p.base!=='string'||typeof p.attempt!=='string'||!/^[1-9][0-9]{0,18}$/.test(p.base)||!/^[1-9][0-9]{0,18}$/.test(p.attempt)||!Array.isArray(p.parts)||p.parts.length>128||p.parts.some(x=>!x||!['text','reasoning'].includes(x.kind)||typeof x.text!=='string')||p.parts.reduce((n,x)=>n+x.text.length,0)>65536))throw new Error('Invalid hosted stream preview');
  return value;
}
export async function* decodeHostedStream(response,{signal,idleTimeout=30000}={}) {
  if(!response.body||!response.headers.get('content-type')?.includes('text/event-stream')){await response.body?.cancel();throw new Error('Hosted SSE unavailable');}
  if(!Number.isFinite(idleTimeout)||idleTimeout<=0)throw new TypeError('Invalid stream idle timeout');
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let buffer='',data=[],frameSize=0,timer,failure;
  const cancel=reason=>{failure=reason;void reader.cancel(reason).catch(()=>{});};
  const abort=()=>cancel(signal.reason);
  const watch=()=>{clearTimeout(timer);timer=setTimeout(()=>cancel(new Error('Hosted stream idle timeout')),idleTimeout);};
  signal?.addEventListener('abort',abort,{once:true});
  try {
    signal?.throwIfAborted();watch();
    while(true) {
      const {done,value}=await reader.read();
      if(failure)throw failure;
      signal?.throwIfAborted();
      if(done)break;
      watch();buffer+=decoder.decode(value,{stream:true});
      let end;
      while((end=buffer.indexOf('\n'))!==-1) {
        const line=buffer.slice(0,end).replace(/\r$/,'');buffer=buffer.slice(end+1);
        frameSize+=line.length+1;
        if(frameSize>maximumFrame)throw new Error('Hosted stream frame too large');
        if(!line) {
          frameSize=0;
          if(data.length){const text=data.join('\n');data=[];yield validateHostedFrame(JSON.parse(text));}
        }else if(line.startsWith('data:'))data.push(line.slice(5).trimStart());
      }
      if(buffer.length+frameSize>maximumFrame)throw new Error('Hosted stream frame too large');
    }
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);try{await reader.cancel();}finally{reader.releaseLock();}}
}
