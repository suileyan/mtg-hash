# mtg-hash
**Multi-threading Hash**
一个基于SparkMD5的文件哈希计算库，支持单线程和多线程计算，并提供文件批量处理功能。

## 依赖

- SparkMD5
- Worker
- pLimit

## 安装

```bash
npm install mtg-hash

yarn add mtg-hash
```

## 使用

本模块支持多个默认导出，可以按需导入。
| 函数名 | 说明 | 参数及参数类型 | 回调参数 | 返回类型 |
| --- | --- | --- | --- | --- |
| createChunks | 创建文件切片 | file: File, chunkSize: number | 无 | Blob[] |
| calculateHash | 计算文件哈希值 (自动模式) | file: File,options:HashOptions | current: number,total: number,percent: string; | Promise<string> |
| singleThreadHash | 单线程计算文件哈希值 (file<10MB) | chunks:Blob[],onProgress?: (data:ProgressData)=>void | current: number,total: number,percent: string; | Promise<string> |
| multiThreadHash | 多线程计算大文件哈希值 (file>10MB) | chunks:Blob[],onProgress?: (data:ProgressData)=>void | current: number,total: number,percent: string; | Promise<string> |
| calculateAllHashes | 批量计算文件哈希值 (files > 1) | files:File[],options:AllHashOptions | current: number,total: number,percent: string; | Promise<string> |

## 回调怎么使用？

以calculateHash为例，回调参数如下：

```ts
calculateHash(file,{
  chunkSize:1024*1024,//设置为每1MB一次
  useWorkerThreshold:1024*1024*10,//设置启动多线程的阈值
  onProgress:(data)=>{
    console.log(data)//data.current:当前计算的文件块，data.total:总文件块，data.percent:当前计算的文件块的百分比
  }
})

```

## 类型

### ProgressData

```ts
interface ProgressData {
  current: number;  // 已处理块数
  total: number;    // 总块数
  percent: string;  // 进度百分比
}
```

### HashOptions

```ts
interface HashOptions {
  chunkSize?: number; // 每个分块的大小（字节），默认10MB
  useWorkerThreshold?: number; // 启用多线程的阈值（字节），文件大于该值使用Worker，默认10MB
  onProgress?: (data: ProgressData) => void; // 单个文件进度回调
}
```


### AllHashOptions

```ts
interface AllHashOptions extends HashOptions {
  maxConcurrency?: number; // 最大并发文件处理数，默认使用硬件并发数
  onFileProgress?: (data: ProgressData & { file: string }) => void; // 单个文件进度回调（带文件名）
  onTotalProgress?: (data: Omit<ProgressData, 'name'>) => void; // 全局总进度回调
}
```

### HashResult 

```ts
interface HashResult {
   name: string;     // 文件名
  hash: string | null; // 哈希值（失败为null）
  error?: Error;    // 错误信息
}
```

## 浏览器兼容性

|浏览器|支持|注意事项|
|---|---|--|
|Chrome 89+|✅|完美支持|
|Firefox 78+|✅|需要启用workers|
|Safari 15+|✅|需要 HTTPS 环境|
|Edge 89+|✅|完美支持|

## 模块出现问题请联系    3220145931@qq.com

## 修复多线程计算blob传递错误 25/3/2





