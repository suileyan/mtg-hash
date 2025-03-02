import SparkMD5 from 'spark-md5';
import pLimit from 'p-limit';

declare global {
  interface Worker {
    postMessage(message: any, transfer: Transferable[]): void;
  }
}

export interface ProgressData {
  //文件名称
  name?: string;
  //当前已处理的块数
  current: number;
  //总块数
  total: number;
  //进度百分比（保留1位小数）
  percent: string;
}

export interface HashOptions {
  //文件分块大小（字节），默认10MB
  chunkSize?: number;
  //启用多线程的阈值（字节），文件大于该值使用Worker，默认10MB
  useWorkerThreshold?: number;
  //单个文件进度回调
  onProgress?: (data: ProgressData) => void;
}

export interface AllHashOptions extends HashOptions {
  //最大并发文件处理数，默认使用硬件并发数
  maxConcurrency?: number;
  //单个文件进度回调（带文件名）
  onFileProgress?: (data: ProgressData & { file: string }) => void;
  //全局总进度回调
  onTotalProgress?: (data: Omit<ProgressData, 'name'>) => void;
}

export interface HashResult {
  //文件名
  name: string;
  //计算完成的哈希值（失败时为null）
  hash: string | null;
  //错误信息（成功时undefined）
  error?: Error;
}


 // @param file - 要处理的文件对象
 // @param chunkSize - 每个分块的大小（字节）
 // @returns 分块数组

 export const createChunks = (file: File, chunkSize: number): Blob[] => {
  const chunks: Blob[] = [];
  for (let i = 0; i < file.size; i += chunkSize) {
    const end = Math.min(i + chunkSize, file.size);
    chunks.push(file.slice(i, end));
  }
  return chunks;
};

 // @param chunks - 文件分块数组
 // @param onProgress - 进度回调
 // @returns Promise解析为最终哈希值

 export const singleThreadHash = async (
  chunks: Blob[],
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
      percent: ((i + 1) / chunks.length * 100).toFixed(1)
    });
  }
  
  return spark.end();
};

// @param chunks - 文件分块数组
// @param onProgress - 进度回调
// @returns Promise解析为最终哈希值

export const multiThreadHash = (
  chunks: Blob[],
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

    // 处理消息
    const handleMessage = (worker: Worker) => 
      (e: MessageEvent<{ index: number; buffer?: ArrayBuffer; error?: string }>) => {
        const { index, buffer, error } = e.data;

        // 错误处理
        if (error) {
          workers.forEach(w => w.terminate());
          reject(new Error(`分块 ${index} 错误: ${error}`));
          return;
        }

        if (!buffer) {
          workers.forEach(w => w.terminate());
          reject(new Error(`分块 ${index} 数据为空`));
          return;
        }

        // 更新哈希计算
        spark.append(buffer);
        processedChunks++;

        // 更新进度
        onProgress?.({
          current: processedChunks,
          total: chunks.length,
          percent: ((processedChunks / chunks.length) * 100).toFixed(1)
        });

        // 分配新任务
        if (currentIndex < chunks.length) {
          const chunk = chunks[currentIndex];
          const url = URL.createObjectURL(chunk);
          worker.postMessage({ index: currentIndex, url });
          currentIndex++;
        } else {
          worker.terminate();
        }

        // 完成处理
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
        reject(new Error(`Worker 错误: ${e.message}`));
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

// @param file - 目标文件
// @param options - 配置选项
// @returns Promise解析为文件哈希值

export const calculateHash = async (
  file: File,
  options: HashOptions = {}
): Promise<string> => {
  const {
    chunkSize = 10 * 1024 * 1024,
    useWorkerThreshold = 10 * 1024 * 1024,
    onProgress
  } = options;

  // 创建分块
  const chunks = createChunks(file, chunkSize);
  
  // 根据文件大小选择计算模式
  return file.size >= useWorkerThreshold 
    ? multiThreadHash(chunks, (progress) => 
        onProgress?.({ ...progress, name: file.name })
      )
    : singleThreadHash(chunks, (progress) => 
        onProgress?.({ ...progress, name: file.name })
      );
};

//  @param files - 文件数组
//  @param options - 配置选项
//  @returns Promise解析为结果数组

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
  const progressMap = new Map<string, number>(); // 文件名 -> 已处理块数
  let totalProcessedChunks = 0;                  // 全局已处理块数
  const totalChunks = files.reduce((sum, file) => 
    sum + Math.ceil(file.size / (options.chunkSize || 10 * 1024 * 1024)), 
    0
  );

  // 处理单个文件
  // @param file - 目标文件
  // @returns Promise解析为哈希值

  const processFile = async (file: File): Promise<string> => {
    let processed = 0; // 当前文件已处理块数
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