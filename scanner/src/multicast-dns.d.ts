// multicast-dns ships no types. Declared narrowly on purpose: widening this
// later is easy, whereas an `any` here would quietly cover a misuse.
declare module 'multicast-dns' {
  interface MdnsRecord {
    name: string;
    type: string;
    data?: unknown;
  }
  interface MdnsResponse {
    answers: MdnsRecord[];
    additionals?: MdnsRecord[];
  }
  interface Mdns {
    // The remote-info second argument carries the responder's address, which
    // is how a record is attributed to the device that actually sent it
    // rather than to every device discovered so far.
    on(event: 'response', listener: (response: MdnsResponse, rinfo: { address: string; port: number }) => void): void;
    // The underlying socket can emit 'error' (no multicast-capable
    // interface, EACCES, ...); an EventEmitter with no listener for it
    // throws, so this must be handled rather than left untyped-and-ignored.
    on(event: 'error', listener: (err: Error) => void): void;
    query(query: { questions: Array<{ name: string; type: string }> }): void;
    destroy(): void;
  }
  export default function makeMdns(): Mdns;
}
