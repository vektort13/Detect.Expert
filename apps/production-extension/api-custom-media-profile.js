// ADR-101: public routing label for three selected booleans; never authentication.
export function mediaProfileChannel(value) {
  const flags=['supported','smooth','powerEfficient'].map(key=>Object.getOwnPropertyDescriptor(value??{},key)?.value);
  if(flags.some(flag=>typeof flag!=='boolean'))return null;
  return 'detect-expert-media-v1:'+flags.map(flag=>flag?'1':'0').join('');
}
