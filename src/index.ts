import SparkMD5 from 'spark-md5';
import pLimit from 'p-limit';

declare global {
  interface Worker {
    postMessage(message: any, transfer: Transferable[]): void;
  }
}

// 新增 Chunk 类型扩展 Blob
interface Chunk extends Blob {
  fileId: string; // 用于关联原始文件
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

// 修改 createChunks 返回 Chunk 类型
export const createChunks = (file: File, chunkSize: number): Chunk[] => {
  const chunks: Chunk[] = [];
  for (let i = 0; i < file.size; i += chunkSize) {
    const end = Math.min(i + chunkSize, file.size);
    const chunk = file.slice(i, end) as Chunk;
    chunk.fileId = file.name; // 注入文件名标识
    chunks.push(chunk);
  }
  return chunks;
};

// 单线程处理（修复 name 来源）
export const singleThreadHash = async (
  chunks: Chunk[],
  fileName: string, // 新增 fileName 参数
  onProgress?: (data: ProgressData) => void
): Promise<string> => {
  const spark = new SparkMD5.ArrayBuffer();
  
  for (let i = 0; i < chunks.length; i++) {
    const buffer = await new Promise<ArrayBuffer>((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as ArrayBuffer);
      reader.readAsArrayBuffer(chunks[i]);
    });

    spark.append(buffer);
    
    onProgress?.({
      current: i + 1,
      total: chunks.length,
      percent: ((i + 1) / chunks.length * 100).toFixed(1),
      name: fileName // 使用传入的文件名
    });
  }
  
  return spark.end();
};

// 多线程处理（新增 fileName 参数）
export const multiThreadHash = (
  chunks: Chunk[],
  fileName: string, // 新增 fileName 参数
  onProgress?: (data: ProgressData) => void
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const workerCount = Math.min(navigator.hardwareConcurrency || 4, chunks.length);
    const workers: Worker[] = [];
    let currentIndex = 0;
    let processedChunks = 0;
    const spark = new SparkMD5.ArrayBuffer();

    const createWorker = (): Worker => {
      const workerCode = `
        self.onmessage = async ({ data: { index, chunk } }) => {
          try {
            const buffer = await chunk.arrayBuffer();
            self.postMessage({ index, buffer }, [buffer]);
          } catch (error) {
            self.postMessage({ 
              index, 
              error: error instanceof Error ? error.message : String(error)
            });
          }
        };
      `;
      return new Worker(URL.createObjectURL(new Blob([workerCode])));
    };

    const handleMessage = (worker: Worker) => 
      (e: MessageEvent<{ index: number; buffer?: ArrayBuffer; error?: string }>) => {
        const { index, buffer, error } = e.data;

        if (error) {
          workers.forEach(w => w.terminate());
          reject(new Error(`分块处理错误: ${error}`));
          return;
        }

        if (!buffer) {
          workers.forEach(w => w.terminate());
          reject(new Error(`分块数据为空: ${index}`));
          return;
        }

        spark.append(buffer);
        processedChunks++;

        onProgress?.({
          current: processedChunks,
          total: chunks.length,
          percent: ((processedChunks / chunks.length) * 100).toFixed(1),
          name: fileName // 使用传入的文件名
        });

        if (currentIndex < chunks.length) {
          const chunk = chunks[currentIndex];
          worker.postMessage(
            { index: currentIndex, chunk },
            [chunk]
          );
          currentIndex++;
        } else {
          worker.terminate();
        }

        if (processedChunks === chunks.length) {
          workers.forEach(w => w.terminate());
          resolve(spark.end());
        }
      };

    for (let i = 0; i < workerCount; i++) {
      const worker = createWorker();
      worker.onmessage = handleMessage(worker);
      worker.onerror = (e) => {
        workers.forEach(w => w.terminate());
        reject(new Error(`Worker错误: ${e.message}`));
      };

      if (currentIndex < chunks.length) {
        const chunk = chunks[currentIndex];
        worker.postMessage(
          { index: currentIndex, chunk },
          [chunk]
        );
        currentIndex++;
      }
      workers.push(worker);
    }
  });
};

// 主函数修改
export const calculateHash = async (
  file: File,
  options: HashOptions = {}
): Promise<string> => {
  const {
    chunkSize = 10 * 1024 * 1024,
    useWorkerThreshold = 10 * 1024 * 1024,
    onProgress
  } = options;

  const chunks = createChunks(file, chunkSize);
  const fileName = file.name; // 获取原始文件名

  // 包装进度回调
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

// 批量计算保持不变...