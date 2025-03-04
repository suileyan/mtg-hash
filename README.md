# mtg-hash
**Multi-threading Hash / 多线程哈希**
一个基于SparkMD5的文件哈希计算库，支持单线程和多线程计算，并提供文件批量处理功能。

## Dependencies / 依赖

- SparkMD5
- Worker
- pLimit

## Installation / 安装

```bash
npm install mtg-hash

yarn add mtg-hash
```

## Usage / 使用

本模块支持多个默认导出，可以按需导入。

| Function Name / 函数名 | Description / 说明 | Parameters and Types / 参数及参数类型 | Callback Parameters / 回调参数 | Return Type / 返回类型 |
| --- | --- | --- | --- | --- |
| createChunks | Create file chunks / 创建文件切片 | file: File, chunkSize: number | None / 无 | Blob[] |
| calculateHash | Calculate file hash (automatic mode) / 计算文件哈希值 (自动模式) | file: File, options: HashOptions | current: number, total: number, percent: string; | Promise<string> |
| singleThreadHash | Single-threaded file hash calculation (file < 10MB) / 单线程计算文件哈希值 (file<10MB) | chunks: Blob[], onProgress?: (data: ProgressData) => void | current: number, total: number, percent: string; | Promise<string> |
| multiThreadHash | Multi-threaded large file hash calculation (file > 10MB) / 多线程计算大文件哈希值 (file>10MB) | chunks: Blob[], onProgress?: (data: ProgressData) => void | current: number, total: number, percent: string; | Promise<string> |
| calculateAllHashes | Batch file hash calculation (files > 1) / 批量计算文件哈希值 (files > 1) | files: File[], options: AllHashOptions | current: number, total: number, percent: string; | Promise<string> |

## How to use callbacks? / 回调怎么使用？

Take `calculateHash` as an example, the callback parameters are as follows:  
以 `calculateHash` 为例，回调参数如下：

```ts
calculateHash(file, {
  chunkSize: 1024 * 1024, // Set to 1MB per chunk / 设置为每1MB一次
  useWorkerThreshold: 1024 * 1024 * 10, // Set the threshold for starting multi-threading / 设置启动多线程的阈值
  onProgress: (data) => {
    console.log(data) // data.current: current file chunk being calculated / 当前计算的文件块
                      // data.total: total file chunks / 总文件块
                      // data.percent: percentage of current file chunk being calculated / 当前计算的文件块的百分比
  }
})
```

## Types / 类型

### ProgressData

```ts
interface ProgressData {
  name?: string;     // File name / 文件名
  current: number;   // Number of processed chunks / 已处理块数
  total: number;     // Total number of chunks / 总块数
  percent: string;   // Progress percentage / 进度百分比
}
```

### HashOptions

```ts
interface HashOptions {
  chunkSize?: number; // Size of each chunk in bytes, default is 10MB / 每个分块的大小（字节），默认10MB
  useWorkerThreshold?: number; // Threshold for enabling multi-threading in bytes, files larger than this use Worker, default is 10MB / 启用多线程的阈值（字节），文件大于该值使用Worker，默认10MB
  onProgress?: (data: ProgressData) => void; // Progress callback for a single file / 单个文件进度回调
}
```

### AllHashOptions

```ts
interface AllHashOptions extends HashOptions {
  maxConcurrency?: number; // Maximum number of concurrent file processing, default uses hardware concurrency / 最大并发文件处理数，默认使用硬件并发数
  onFileProgress?: (data: ProgressData & { file: string }) => void; // Progress callback for a single file with file name / 单个文件进度回调（带文件名）
  onTotalProgress?: (data: Omit<ProgressData, 'name'>) => void; // Global total progress callback / 全局总进度回调
}
```

### HashResult 

```ts
interface HashResult {
  name: string;     // File name / 文件名
  hash: string | null; // Hash value (null if failed) / 哈希值（失败为null）
  error?: Error;    // Error information / 错误信息
}
```

## Browser Compatibility / 浏览器兼容性

| Browser / 浏览器 | Supported / 支持 | Notes / 注意事项 |
| --- | --- | --- |
| Chrome 89+ | ✅ | Perfect support / 完美支持 |
| Firefox 78+ | ✅ | Workers need to be enabled / 需要启用workers |
| Safari 15+ | ✅ | Requires HTTPS environment / 需要 HTTPS 环境 |
| Edge 89+ | ✅ | Perfect support / 完美支持 |

## For issues with the module, please contact / 模块出现问题请联系

3220145931@qq.com

## Fixed multi-threaded blob transfer error / 修复多线程计算blob传递错误 25/3/2





