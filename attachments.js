const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function validateAttachmentName(name) {
  if(typeof name!=='string'||!name||name.length>200||name.startsWith('.')||name.trim()!==name||/[\\/\x00-\x1f\x7f:*?"<>|]/.test(name))throw new TypeError('Invalid attachment filename');
}
export function validateAttachmentSource(source) {
  validateAttachmentName(source?.name);
  if(!uuid.test(source.id)||!['upload','stored'].includes(source.kind)||typeof source.mediaType!=='string'||source.mediaType.length>120||!/^[\w.+-]+\/[\w.+-]+$/.test(source.mediaType)||!Number.isInteger(source.bytes)||source.bytes<0||source.bytes>25*1024*1024)throw new TypeError('Invalid attachment source');
  if(source.kind==='upload'&&!/^[a-f0-9]{64}$/.test(source.sha256))throw new TypeError('Invalid attachment digest');
  if(source.kind==='stored'&&(!['project','chat'].includes(source.scope?.kind)||typeof source.scope.id!=='string'||!source.scope.id||source.scope.id.length>200))throw new TypeError('Invalid stored attachment scope');
  return source;
}
export function validateDocument(document) {
  validateAttachmentName(document?.name);
  if(document.kind!=='document'||!/^[a-f0-9]{64}$/.test(document.id)||document.mediaType!=='text/plain'||!Number.isInteger(document.bytes)||document.bytes<=0||document.bytes>4000000||typeof document.truncated!=='boolean')throw new TypeError('Invalid converted document');
  return document;
}
export function toBase64(bytes) {
  let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(text);
}
