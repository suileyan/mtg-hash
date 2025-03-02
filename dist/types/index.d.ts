declare global {
    interface Worker {
        postMessage(message: any, transfer: Transferable[]): void;
    }
}
export interface ProgressData {
    name?: string;
    current: number;
    total: number;
    percent: string;
}
export interface HashOptions {
    chunkSize?: number;
    useWorkerThreshold?: number;
    onProgress?: (data: ProgressData) => void;
}
export interface AllHashOptions extends HashOptions {
    maxConcurrency?: number;
    onFileProgress?: (data: ProgressData & {
        file: string;
    }) => void;
    onTotalProgress?: (data: Omit<ProgressData, 'name'>) => void;
}
export interface HashResult {
    name: string;
    hash: string | null;
    error?: Error;
}
export declare const createChunks: (file: File, chunkSize: number) => Blob[];
export declare const singleThreadHash: (chunks: Blob[], onProgress?: (data: ProgressData) => void) => Promise<string>;
export declare const multiThreadHash: (chunks: Blob[], onProgress?: (data: ProgressData) => void) => Promise<string>;
export declare const calculateHash: (file: File, options?: HashOptions) => Promise<string>;
export declare const calculateAllHashes: (files: File[], options?: AllHashOptions) => Promise<HashResult[]>;
