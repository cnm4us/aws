// Sign-in advances request generations before it authenticates. Changing the
// screen group then would unmount Account and cancel its own pending login.
// Reset screen history when the principal/API changes; keep request generations
// on feed/checkpoint state and stale-completion guards separately.
export const viewerIdentityKey=(apiOrigin:string,viewerId:number|null|undefined)=>`${apiOrigin}:${viewerId??'guest'}`;
