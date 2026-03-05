import SparkMD5 from 'spark-md5';
import pLimit from 'p-limit';

declare global {
  interface Worker {
    postMessage(message: any, transfer: Transferable[]): void;
  }
}


interface Chunk extends Blob {
  fileId: string;
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
  onFileProgress?: (data: ProgressData & { file: string }) => void;
  onTotalProgress?: (data: Omit<ProgressData, 'name'>) => void;
}

export interface HashResult {
  name: string;
  hash: string | null;
  error?: Error;
}

const DEFAULT_CHUNK_SIZE = 10 * 1024 * 1024;
const MIN_CHUNK_SIZE = 64 * 1024;
const MAX_CHUNK_SIZE = 100 * 1024 * 1024;
const MIN_WORKER_THRESHOLD = 0;
const MAX_CONCURRENCY = 16;
const DEFAULT_CONCURRENCY = 4;

function validateChunkSize(chunkSize: number): void {
  if (!Number.isFinite(chunkSize) || chunkSize <= 0) {
    throw new TypeError(`chunkSize must be a positive number, got ${chunkSize}`);
  }
  if (chunkSize < MIN_CHUNK_SIZE) {
    throw new RangeError(`chunkSize must be at least ${MIN_CHUNK_SIZE} bytes (64KB), got ${chunkSize}`);
  }
  if (chunkSize > MAX_CHUNK_SIZE) {
    throw new RangeError(`chunkSize must not exceed ${MAX_CHUNK_SIZE} bytes (100MB), got ${chunkSize}`);
  }
}

function validateWorkerThreshold(threshold: number): void {
  if (!Number.isFinite(threshold) || threshold < MIN_WORKER_THRESHOLD) {
    throw new TypeError(`useWorkerThreshold must be a non-negative number, got ${threshold}`);
  }
}

function validateMaxConcurrency(concurrency: number): void {
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new TypeError(`maxConcurrency must be a positive integer, got ${concurrency}`);
  }
  if (concurrency > MAX_CONCURRENCY) {
    throw new RangeError(`maxConcurrency must not exceed ${MAX_CONCURRENCY}, got ${concurrency}`);
  }
}

function validateFile(file: unknown): asserts file is File {
  if (!(file instanceof File)) {
    throw new TypeError(`Expected File object, got ${file === null ? 'null' : typeof file}`);
  }
}

function validateFiles(files: unknown[]): asserts files is File[] {
  if (!Array.isArray(files)) {
    throw new TypeError(`Expected array of File objects, got ${typeof files}`);
  }
  files.forEach((file, index) => {
    if (!(file instanceof File)) {
      throw new TypeError(`Expected File object at index ${index}, got ${file === null ? 'null' : typeof file}`);
    }
  });
}

export const createChunks = (file: File, chunkSize: number): Chunk[] => {
  validateFile(file);
  validateChunkSize(chunkSize);

  const chunks: Chunk[] = [];
  for (let i = 0; i < file.size; i += chunkSize) {
    const end = Math.min(i + chunkSize, file.size);
    const chunk = file.slice(i, end) as Chunk;
    chunk.fileId = file.name;
    chunks.push(chunk);
  }
  return chunks;
};


export const singleThreadHash = async (
  chunks: Chunk[],
  fileName: string,
  onProgress?: (data: ProgressData) => void
): Promise<string> => {
  if (!Array.isArray(chunks)) {
    throw new TypeError('chunks must be an array');
  }

  const spark = new SparkMD5.ArrayBuffer();

  for (let i = 0; i < chunks.length; i++) {
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result;
        if (result instanceof ArrayBuffer) {
          resolve(result);
        } else {
          reject(new Error('Failed to read file chunk as ArrayBuffer'));
        }
      };
      reader.onerror = () => reject(new Error(`Failed to read chunk ${i} of file "${fileName}"`));
      reader.readAsArrayBuffer(chunks[i]);
    });

    spark.append(buffer);

    onProgress?.({
      current: i + 1,
      total: chunks.length,
      percent: ((i + 1) / chunks.length * 100).toFixed(1),
      name: fileName
    });
  }

  return spark.end();
};


export const multiThreadHash = (
  chunks: Chunk[],
  fileName: string,
  onProgress?: (data: ProgressData) => void
): Promise<string> => {
  if (!Array.isArray(chunks)) {
    throw new TypeError('chunks must be an array');
  }
  if (chunks.length === 0) {
    return Promise.resolve(new SparkMD5.ArrayBuffer().end());
  }

  return new Promise((resolve, reject) => {
    const workerCount = Math.min(navigator.hardwareConcurrency || DEFAULT_CONCURRENCY, chunks.length);
    const workers: Worker[] = [];
    let currentIndex = 0;
    let processedChunks = 0;
    const spark = new SparkMD5.ArrayBuffer();
    const objectURLs: string[] = [];

    const cleanup = () => {
      workers.forEach(w => w.terminate());
      objectURLs.forEach(url => {
        try {
          URL.revokeObjectURL(url);
        } catch {
        }
      });
      objectURLs.length = 0;
    };

    const createWorker = (): Worker => {
      const workerCode = `
        self.onmessage = async ({ data: { index, url } }) => {
          try {
            const response = await fetch(url);
            if (!response.ok) {
              throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
            }
            const buffer = await response.arrayBuffer();
            self.postMessage({ index, buffer }, [buffer]);
          } catch (error) {
            self.postMessage({
              index,
              error: error instanceof Error ? error.message : String(error)
            });
          } finally {
            URL.revokeObjectURL(url);
          }
        };
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      objectURLs.push(url);
      return new Worker(url);
    };

    const handleMessage = (worker: Worker) =>
      (e: MessageEvent<{ index: number; buffer?: ArrayBuffer; error?: string }>) => {
        const { index, buffer, error } = e.data;

        if (error) {
          cleanup();
          reject(new Error(`Chunk processing error at index ${index}: ${error}`));
          return;
        }

        if (!buffer || !(buffer instanceof ArrayBuffer)) {
          cleanup();
          reject(new Error(`Invalid buffer received for chunk at index ${index}`));
          return;
        }

        spark.append(buffer);
        processedChunks++;

        onProgress?.({
          current: processedChunks,
          total: chunks.length,
          percent: ((processedChunks / chunks.length) * 100).toFixed(1),
          name: fileName
        });

        if (currentIndex < chunks.length) {
          const chunk = chunks[currentIndex];
          const url = URL.createObjectURL(chunk);
          objectURLs.push(url);
          worker.postMessage({ index: currentIndex, url });
          currentIndex++;
        } else {
          worker.terminate();
        }

        if (processedChunks === chunks.length) {
          cleanup();
          resolve(spark.end());
        }
      };

    for (let i = 0; i < workerCount; i++) {
      const worker = createWorker();
      worker.onmessage = handleMessage(worker);
      worker.onerror = (e) => {
        cleanup();
        reject(new Error(`Worker error: ${e.message}`));
      };

      if (currentIndex < chunks.length) {
        const chunk = chunks[currentIndex];
        const url = URL.createObjectURL(chunk);
        objectURLs.push(url);
        worker.postMessage({ index: currentIndex, url });
        currentIndex++;
      }
      workers.push(worker);
    }
  });
};


export const calculateHash = async (
  file: File,
  options: HashOptions = {}
): Promise<string> => {
  validateFile(file);

  const {
    chunkSize = DEFAULT_CHUNK_SIZE,
    useWorkerThreshold = DEFAULT_CHUNK_SIZE,
    onProgress
  } = options;

  validateChunkSize(chunkSize);
  validateWorkerThreshold(useWorkerThreshold);

  const chunks = createChunks(file, chunkSize);
  const fileName = file.name;

  const progressHandler = (progress: Omit<ProgressData, 'name'>) => {
    onProgress?.({
      ...progress,
      name: fileName
    });
  };

  return file.size >= useWorkerThreshold
    ? multiThreadHash(chunks, fileName, progressHandler)
    : singleThreadHash(chunks, fileName, progressHandler);
};

export const calculateAllHashes = async (
  files: File[],
  options: AllHashOptions = {}
): Promise<HashResult[]> => {
  validateFiles(files);

  const maxConcurrency = Math.min(
    options.maxConcurrency || DEFAULT_CONCURRENCY,
    navigator.hardwareConcurrency || DEFAULT_CONCURRENCY
  );
  validateMaxConcurrency(maxConcurrency);

  const limiter = pLimit(maxConcurrency);

  const progressMap = new Map<string, number>();
  let totalProcessedChunks = 0;

  const effectiveChunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE;
  validateChunkSize(effectiveChunkSize);

  const totalChunks = files.reduce((sum, file) =>
    sum + Math.ceil(file.size / effectiveChunkSize),
    0
  );

  const processFile = async (file: File): Promise<string> => {
    let processed = 0;
    const total = Math.ceil(file.size / effectiveChunkSize);

    return calculateHash(file, {
      ...options,
      onProgress: (progress) => {
        const prev = progressMap.get(file.name) || 0;
        progressMap.set(file.name, progress.current);

        totalProcessedChunks += progress.current - prev;
        processed = progress.current;

        options.onFileProgress?.({
          ...progress,
          file: file.name
        });

        options.onTotalProgress?.({
          current: totalProcessedChunks,
          total: totalChunks,
          percent: ((totalProcessedChunks / totalChunks) * 100).toFixed(1)
        });
      }
    });
  };

  const tasks = files.map(file =>
    limiter(async () => {
      try {
        const hash = await processFile(file);
        return { success: true as const, hash };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error : new Error(String(error))
        };
      }
    })
  );

  const results = await Promise.all(tasks);

  return results.map((result, index): HashResult => {
    const file = files[index];
    return result.success
      ? { name: file.name, hash: result.hash ?? null, error: undefined }
      : { name: file.name, hash: null, error: result.error };
  });
};
