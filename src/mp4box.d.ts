declare module 'mp4box' {
  export function createFile(): any;
  export class DataStream {
    static BIG_ENDIAN: boolean;
    constructor(buffer: any, byteOffset: number, endianness: boolean);
    buffer: ArrayBuffer;
  }
}
