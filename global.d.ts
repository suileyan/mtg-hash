declare module '*.mjs' {
    const value: any;
    export default value;
  }

declare module 'spark-md5' {
  export class ArrayBuffer {
    append(buffer: ArrayBuffer): void;
    end(raw?: boolean): string;
  }
}

// 声明Worker类型
interface Worker {
  postMessage(message: any, transfer: Transferable[]): void;
}