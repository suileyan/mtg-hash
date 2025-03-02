import SparkMD5 from 'spark-md5';
import pLimit from 'p-limit';

declare global {
  interface Worker {
    postMessage(message: any, transfer: Transferable[]): void;
  }
}


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


export const createChunks = (file: File, chunkSize: number): Chunk[] => {
  const chunks: Chunk[] = [];
  for (let i = 0; i < file.size; i += chunkSize) {
    const end = Math.min(i + chunkSize, file.size);
    const chunk = file.slice(i, end) as Chunk;
    chunk.fileId = file.name; // 注入文件名
    chunks.push(chunk);
  }
  return chunks;
};


export const singleThreadHash = async (
  chunks: Chunk[],
  fileName: string, 
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
  return new Promise((resolve, reject) => {
    const workerCount = Math.min(navigator.hardwareConcurrency || 4, chunks.length);
    const workers: Worker[] = [];
    let currentIndex = 0;
    let processedChunks = 0;
    const spark = new SparkMD5.ArrayBuffer();

    // 创建Worker
    const createWorker = (): Worker => {
      const workerCode = `
        self.onmessage = async ({ data: { index, url } }) => {
          try {
            const response = await fetch(url);
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
          name: fileName
        });

        if (currentIndex < chunks.length) {
          const chunk = chunks[currentIndex];
          const url = URL.createObjectURL(chunk);
          worker.postMessage({ index: currentIndex, url }); 
          currentIndex++;
        } else {
          worker.terminate();
        }

        if (processedChunks === chunks.length) {
          workers.forEach(w => w.terminate());
          resolve(spark.end());
        }
      };

    // 初始化Worker
    for (let i = 0; i < workerCount; i++) {
      const worker = createWorker();
      worker.onmessage = handleMessage(worker);
      worker.onerror = (e) => {
        workers.forEach(w => w.terminate());
        reject(new Error(`Worker错误: ${e.message}`));
      };

      if (currentIndex < chunks.length) {
        const chunk = chunks[currentIndex];
        const url = URL.createObjectURL(chunk);
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
  const {
    chunkSize = 10 * 1024 * 1024,
    useWorkerThreshold = 10 * 1024 * 1024,
    onProgress
  } = options;

  const chunks = createChunks(file, chunkSize);
  const fileName = file.name; // 获取原始文件名


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
  // 参数校验
  if (!Array.isArray(files)) throw new TypeError('必须传入文件数组');
  if (files.some(f => !(f instanceof File))) {
    throw new TypeError('文件数组中包含非File对象');
  }

  // 计算最大并发数
  const maxConcurrency = Math.min(
    options.maxConcurrency || 4,
    navigator.hardwareConcurrency || 4
  );
  const limiter = pLimit(maxConcurrency);

  // 进度追踪
  const progressMap = new Map<string, number>(); 
  let totalProcessedChunks = 0;               
  const totalChunks = files.reduce((sum, file) => 
    sum + Math.ceil(file.size / (options.chunkSize || 10 * 1024 * 1024)), 
    0
  );



  const processFile = async (file: File): Promise<string> => {
    let processed = 0; 
    const total = Math.ceil(file.size / (options.chunkSize || 10 * 1024 * 1024));
    
    return calculateHash(file, {
      ...options,
      onProgress: (progress) => {
        // 更新文件进度
        const prev = progressMap.get(file.name) || 0;
        progressMap.set(file.name, progress.current);
        
        // 更新全局进度
        totalProcessedChunks += progress.current - prev;
        processed = progress.current;

        // 触发回调
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

  // 创建任务队列
  const tasks = files.map(file => 
    limiter(async () => {
      try {
        const hash = await processFile(file);
        return { success: true, hash };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error : new Error(String(error))
        };
      }
    })
  );

  // 执行并等待所有任务
  const results = await Promise.all(tasks);

  // 转换最终结果
  return results.map((result, index): HashResult => {
    const file = files[index];
    return result.success 
      ? { name: file.name, hash: result.hash ?? null, error: undefined }
      : { name: file.name, hash: null, error: result.error };
  });
};