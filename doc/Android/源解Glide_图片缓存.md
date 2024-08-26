---
title: 源解 Glide 之图片缓存
description: 通过阅读 Glide 源码，了解磁盘缓存、内存缓存、BitmapPool
head:
  - - meta
    - name: description
      content: 通过阅读 Glide 源码，了解磁盘缓存、内存缓存、BitmapPool
  - - meta
    - name: keywords
      content: Android、源码、Glide
---
# 源解 Glide - 图片缓存
---
# 磁盘缓存
## 缓存策略
磁盘缓存策略如下：
- DiskCacheStrategy.ALL : 缓存原始数据和转换后数据
- DiskCacheStrategy.NONE : 不缓存数据
- DiskCacheStrategy.DATA : 仅缓存原始数据
- DiskCacheStrategy.RESOURCE : 仅缓存转换后数据
- DiskCacheStrategy.AUTOMATIC : 【默认】缓存从远程获取的原始数据，缓存从本地加载且解码策略为TRANSFORMED的转换后数据
::: details DiskCacheStrategy源码
```java
public abstract class DiskCacheStrategy {

  //缓存原始数据，则返回 true
  public abstract boolean isDataCacheable(DataSource dataSource);

  //缓存转换后数据，则返回 true
  public abstract boolean isResourceCacheable(boolean isFromAlternateCacheKey, DataSource dataSource, EncodeStrategy encodeStrategy);

  //解码缓存的转换后数据，则返回 true
  public abstract boolean decodeCachedResource();

  //解码缓存的原始数据，则返回 true
  public abstract boolean decodeCachedData();
}
```
:::
## 缓存管理者
磁盘缓存的管理由 `DiskLruCacheWrapper` 负责，其创建时机是在调用 `DecodeHelper#getDiskCache()` 时由 `InternalCacheDiskCacheFactory` 创建。`InternalCacheDiskCacheFactory` 是在 Glide.with() 的 Glide 构建阶段创建。

**InternalCacheDiskCacheFactory的创建**

由下面代码可知，磁盘缓存路径为 /data/data/\<package_name\>/cache/image_manager_disk_cache，大小为 256M
```java
public final class GlideBuilder {

  Glide build(@NonNull Context context) {
    //...
    if (this.diskCacheFactory == null) {
      // 创建磁盘缓存，默认大小约256M // [!code focus:2]
      this.diskCacheFactory = new InternalCacheDiskCacheFactory(context);
    }
    //...
  }
}
```
```java
public final class InternalCacheDiskCacheFactory extends DiskLruCacheFactory {

  // [!code focus:5]
  public InternalCacheDiskCacheFactory(Context context) {
    //默认缓存文件夹 image_manager_disk_cache
    //默认缓存大小 256M
    this(context,DiskCache.Factory.DEFAULT_DISK_CACHE_DIR,DiskCache.Factory.DEFAULT_DISK_CACHE_SIZE);
  }

  public InternalCacheDiskCacheFactory(Context context, long diskCacheSize) {
    this(context, DiskCache.Factory.DEFAULT_DISK_CACHE_DIR, diskCacheSize);
  }

  public InternalCacheDiskCacheFactory(final Context context, final String diskCacheName, long diskCacheSize) {
    super(
        new CacheDirectoryGetter() {
          @Override
          public File getCacheDirectory() {
            //缓存至 cache 路径下 // [!code focus:2]
            File cacheDirectory = context.getCacheDir();
            if (cacheDirectory == null) {
              return null;
            }
            if (diskCacheName != null) {
              return new File(cacheDirectory, diskCacheName);
            }
            return cacheDirectory;
          }
        },
        diskCacheSize);
  }
}
```
**DiskLruCacheWrapper的创建**
```java
final class DecodeHelper<Transcode> {
    DiskCache getDiskCache() {
    // diskCacheProvider 是 LazyDiskCacheProvider 的实例，其持有 InternalCacheDiskCacheFactory,是在 GlideBuilder-创建Engine阶段创建
    return diskCacheProvider.getDiskCache();
  }
}
```
```java
public class Engine implements EngineJobListener, MemoryCache.ResourceRemovedListener, EngineResource.ResourceListener {

  private static class LazyDiskCacheProvider implements DecodeJob.DiskCacheProvider {

    LazyDiskCacheProvider(DiskCache.Factory factory) {
      this.factory = factory;
    }

    @Override
    public DiskCache getDiskCache() {
      if (diskCache == null) {
        synchronized (this) {
          if (diskCache == null) {
            // 调用 InternalCacheDiskCacheFactory#build，实际调用其父类（DiskLruCacheFactory）build() // [!code focus:2]
            diskCache = factory.build();
          }
          if (diskCache == null) {
            diskCache = new DiskCacheAdapter();
          }
        }
      }
      return diskCache;
    }
  }
}
```
```java
public class DiskLruCacheFactory implements DiskCache.Factory {
  //此处由子类 InternalCacheDiskCacheFactory 实现
  public DiskLruCacheFactory(CacheDirectoryGetter cacheDirectoryGetter, long diskCacheSize) {
    this.diskCacheSize = diskCacheSize;
    this.cacheDirectoryGetter = cacheDirectoryGetter;
  }

  @Override
  public DiskCache build() {
    File cacheDir = cacheDirectoryGetter.getCacheDirectory();

    if (cacheDir == null) {
      return null;
    }

    if (!cacheDir.mkdirs() && (!cacheDir.exists() || !cacheDir.isDirectory())) {
      return null;
    }
    //创建 DiskLruCacheWrapper
    return DiskLruCacheWrapper.create(cacheDir, diskCacheSize);
  }
}
```
```java
public class DiskLruCacheWrapper implements DiskCache {

  public static DiskCache create(File directory, long maxSize) {
    return new DiskLruCacheWrapper(directory, maxSize);
  }
}
```
**DiskLruCacheWrapper的磁盘管理**
```java
public class DiskLruCacheWrapper implements DiskCache {

  @Override
  public void put(Key key, Writer writer) {
    //锁住 key，避免并发重复写入
    String safeKey = safeKeyGenerator.getSafeKey(key);
    writeLocker.acquire(safeKey);
    try {
      try {
        //如果已写入，则不再重复写入
        DiskLruCache diskCache = getDiskCache();
        Value current = diskCache.get(safeKey);
        if (current != null) {
          return;
        }
        //写入数据
        DiskLruCache.Editor editor = diskCache.edit(safeKey);
        try {
          File file = editor.getFile(0);
          if (writer.write(file)) {
            editor.commit();
          }
        } finally {
          editor.abortUnlessCommitted();
        }
      } catch (IOException e) {}
    } finally {
      writeLocker.release(safeKey);
    }
  }
}
```
## 原始资源缓存
**存入**
- 通过请求获取到远端数据后，将数据进行编码，将编码后数据、原始数据、RequestOptions存储本地。
- 生成原始数据 Key，Key 由两部分构成：
  - `ModelLoader` 的实现类在`buildLoadData()` 时对传入参数(调用`load()`传入的参数)的封装Key
  - 签名Key，默认为`EmptySignature`
- 根据 Key 将数据存入本地。如果 Key 已存在则不存储。
```java
class SourceGenerator implements DataFetcherGenerator, DataFetcher.DataCallback<Object>, DataFetcherGenerator.FetcherReadyCallback {
  
  @Override
  public boolean startNext() {
    if (dataToCache != null) {
      Object data = dataToCache;
      dataToCache = null;
      //缓存数据
      cacheData(data);
    }
    //...
  }
  
  private void cacheData(Object dataToCache) {
    long startTime = LogTime.getLogTime();
    try {
        Encoder<Object> encoder = helper.getSourceEncoder(dataToCache);
        DataCacheWriter<Object> writer = new DataCacheWriter<>(encoder, dataToCache, helper.getOptions());
        //生成原始数据的 Key，此处 sourceKey 为 url字符串，signature 为 EmptySignature
        originalKey = new DataCacheKey(loadData.sourceKey, helper.getSignature());
        // 将原始数据写入本地文件
        helper.getDiskCache().put(originalKey, writer);
    } finally {
        loadData.fetcher.cleanup();
    }
  }
}
```
**取出**
- 在加载数据过程中，从'转换资源缓存'中没有获取到后，调用获取'原始资源缓存'
- 先获取所有能处理 model (例如，链接字符串) 的 ModelLoader 其内部生成的 Key，
- 然后遍历 Key，结合 signature 生成 originalKey (生成的规则与上面存入的一致了)，根据 originalKey 获取缓存数据
- 有缓存，则进一步获取能处理缓存的 ModelLoader 来加载数据；没有则调用 SourceGenerator 去远程获取。
```java
class DataCacheGenerator implements DataFetcherGenerator, DataFetcher.DataCallback<Object> {

  //在创建时，根据 model 获取所有能处理该类型的 ModelLoader 内部生成的 Key
  DataCacheGenerator(DecodeHelper<?> helper, FetcherReadyCallback cb) {
    this(helper.getCacheKeys(), helper, cb);
  }

  public boolean startNext() {

    while (modelLoaders == null || !hasNextModelLoader()) {
      sourceIdIndex++;
      if (sourceIdIndex >= cacheKeys.size()) {
        return false;
      }
      //遍历生成 Key，这与上面存入相对应。
      Key sourceId = cacheKeys.get(sourceIdIndex);
      Key originalKey = new DataCacheKey(sourceId, helper.getSignature());
      //获取缓存数据，如果有则进一步获取能处理该缓存数据的 ModelLoader
      cacheFile = helper.getDiskCache().get(originalKey);
      if (cacheFile != null) {
        this.sourceKey = sourceId;
        modelLoaders = helper.getModelLoaders(cacheFile);
        modelLoaderIndex = 0;
      }
    }
    // 选择合适的 ModelLoader 和 DataFetcher 加载数据
    //...
    return started;
  }
}
```
## 转换资源缓存
**存入**
- 在原始数据缓存至本地后触发`onDataFetcherReady()`，最后回调到 `DecodeJob#onDataFetcherReady()`，内部对缓存的原始数据进行解析、转换操作，操作完成后将转换后数据进行缓存。
- 先对数据进行解码，然后调用 `onResourceDecoded()` 进行转换，并生成 resourceKey
- 在转换完成后，调用 `notifyEncodeAndRelease()`，执行后续内存缓存，并调用 `DeferredEncodeManager#encode()` 将转换后数据进行缓存，key 为上一步生成的 resourceKey。
```java
class DecodeJob<R> implements DataFetcherGenerator.FetcherReadyCallback, Runnable, Comparable<DecodeJob<?>>, Poolable {

  public void onDataFetcherReady(Key sourceKey, Object data, DataFetcher<?> fetcher, DataSource dataSource, Key attemptedKey) {
    //...
    // 处理数据
    //  解析完成后，会调用 onResourceDecoded() 进行转换，最后会调用 notifyEncodeAndRelease()
    decodeFromRetrievedData();
  }

  <Z> Resource<Z> onResourceDecoded(DataSource dataSource, @NonNull Resource<Z> decoded) {
    //...
    Resource<Z> result = transformed;
    boolean isFromAlternateCacheKey = !decodeHelper.isSourceKey(currentSourceKey);
    if (diskCacheStrategy.isResourceCacheable(isFromAlternateCacheKey, dataSource, encodeStrategy)) {
      final Key key;
      switch (encodeStrategy) {
        case SOURCE:
          key = new DataCacheKey(currentSourceKey, signature);
          break;
        case TRANSFORMED:
          //生成转换资源 Key
          key = new ResourceCacheKey(
                  decodeHelper.getArrayPool(),
                  currentSourceKey,
                  signature,
                  width,
                  height,
                  appliedTransformation,
                  resourceSubClass,
                  options);
          break;
        default:
          throw new IllegalArgumentException("Unknown strategy: " + encodeStrategy);
      }

      LockedResource<Z> lockedResult = LockedResource.obtain(transformed);
      deferredEncodeManager.init(key, encoder, lockedResult);
      result = lockedResult;
    }
    return result;
  }

  private void notifyEncodeAndRelease(Resource<R> resource, DataSource dataSource) {
    //....
    stage = Stage.ENCODE;
    try {
        //在上面解析数据时，由 DecodePath 处理时执行了 transformation， 所以此处为 true.
        //  内部主要是将转换后的资源缓存
        if (deferredEncodeManager.hasResourceToEncode()) {
            deferredEncodeManager.encode(diskCacheProvider, options);
        }
    } finally {}
    //...
  }

  private static class DeferredEncodeManager<Z> {

    void encode(DiskCacheProvider diskCacheProvider, Options options) {
      //缓存至本地
      try {
        diskCacheProvider.getDiskCache().put(key, new DataCacheWriter<>(encoder, toEncode, options));
      } finally {
        toEncode.unlock();
        GlideTrace.endSection();
      }
    }
  }
}
```
**取出**
- 在加载数据过程中，从'内存缓存'中没有获取到后，调用获取 '转换资源缓存'
- 先获取所有能处理 model (例如，链接字符串) 的 ModelLoader 其内部生成的 Key，
- 然后遍历 Key，结合 arrayPool、signature、width、height、transformation、resourceClass、options 生成 resourceKey，根据 resourceKey 获取缓存数据
- 有缓存，则进一步获取能处理缓存的 ModelLoader 来加载数据；没有则调用 DataCacheGenerator 从原始数据缓存获取。
```java
class ResourceCacheGenerator implements DataFetcherGenerator, DataFetcher.DataCallback<Object> {

  public boolean startNext() {
    //根据 model 获取所有能处理该类型的 ModelLoader 内部生成的 Key
    List<Key> sourceIds = helper.getCacheKeys();
    if (sourceIds.isEmpty()) {
      return false;
    }
    List<Class<?>> resourceClasses = helper.getRegisteredResourceClasses();
    while (modelLoaders == null || !hasNextModelLoader()) {
      //...
      //获取 ModelLoader 生成的 Key
      Key sourceId = sourceIds.get(sourceIdIndex);
      Class<?> resourceClass = resourceClasses.get(resourceClassIndex);
      Transformation<?> transformation = helper.getTransformation(resourceClass);
      //生成转换后资源的 Key
      currentKey = new ResourceCacheKey(
              helper.getArrayPool(),
              sourceId,
              helper.getSignature(),
              helper.getWidth(),
              helper.getHeight(),
              transformation,
              resourceClass,
              helper.getOptions());
      //获取缓存数据，如果有则进一步获取能处理该缓存数据的 ModelLoader
      cacheFile = helper.getDiskCache().get(currentKey);
      if (cacheFile != null) {
        sourceKey = sourceId;
        modelLoaders = helper.getModelLoaders(cacheFile);
        modelLoaderIndex = 0;
      }
    }
    // 选择合适的 ModelLoader 和 DataFetcher 加载数据
    //...
    return started;
  }
}
```
# 内存缓存
## MemoryCache
**创建时机与存储结构**
```java
public final class GlideBuilder {

  Glide build(@NonNull Context context) {
    //...
    if (this.memorySizeCalculator == null) {
      // 内存计算器，内部维护了一些用于后面内存计算的“常量”
      //   如: 
      //    - arrayPool大小 = RAM <= 1G ? 2M : 4M
      //		- 应用最大内存 = 应用内存 * (RAM <= 1G ? 0.33F : 0.4F)
      //		- targetBitmapPool大小 = 屏幕宽 * 屏幕高 * 4 * (os < 8.0 ? 4 : (RAM <=1G ? 0 : 1))
      //    - targetMemoryCache大小 = 屏幕宽 * 屏幕高 * 4 * 2.0F
      //    - 可用内存大小 = 应用最大内存 - arrayPool大小
      //    - bitmapPoolSize = (targetBitmapPool大小 + targetMemoryCache大小 <= 可用内存大小) ? targetBitmapPool大小 : 可用内存大小 / ((os < 8.0 ? 4 : (RAM <=1G ? 0 : 1)) + 2.0F) * (os < 8.0 ? 4 : (RAM <=1G ? 0 : 1))
      //		- memoryCacheSize = (targetBitmapPool大小 + targetMemoryCache大小 <= 可用内存大小) ? targetMemoryCache大小 : 可用内存大小 / ((os < 8.0 ? 4 : (RAM <=1G ? 0 : 1)) + 2.0F) * 2.0F
      this.memorySizeCalculator = (new MemorySizeCalculator.Builder(context)).build();
    }

    if (memoryCache == null) {
      // 创建 LruCache，大小为 memoryCacheSize（计算结果如上）
      memoryCache = new LruResourceCache(memorySizeCalculator.getMemoryCacheSize());
    }
    //...
  }
}
```
**存入**
- 存入的时机
  - 当 `ActiveResource#get()` 获取弱引用返回 null 时，执行 `onResourceReleased()`
  - 当调用 `EngineResource#release()` 资源引用计数为 0 时，执行 `onResourceReleased()`
- `onResourceReleased()` 主要执行两个操作：1. 将资源从 ActiveResources 移除；2. 根据配置 `resource.isMemoryCacheable()`（该配置在 requestOption 中设置，默认 true） 为 true，存入 MemoryCache，否则彻底回收。

***存入时机1***
```java
final class ActiveResources {
  synchronized EngineResource<?> get(Key key) {
    ResourceWeakReference activeRef = activeEngineResources.get(key);
    //...
    EngineResource<?> active = activeRef.get();
    if (active == null) {
      //资源回收到 MemoryCache
      cleanupActiveReference(activeRef);
    }
    return active;
  }

  void cleanupActiveReference(@NonNull ResourceWeakReference ref) {
    synchronized (this) {
      activeEngineResources.remove(ref.key);

      if (!ref.isCacheable || ref.resource == null) {
        return;
      }
    }
    EngineResource<?> newResource = new EngineResource<>(ref.resource, /*isMemoryCacheable=*/ true, /*isRecyclable=*/ false, ref.key, listener);
    //调用 onResourceReleased()，将当前资源添加到 MemoryCache
    listener.onResourceReleased(ref.key, newResource);
  }
}
```
***存入时机2***
```java
class EngineResource<Z> implements Resource<Z> {

  void release() {
    boolean release = false;
    synchronized (this) {
      if (--acquired == 0) {
        release = true;
      }
    }
    //当引用计数为 0 时，调用 onResourceReleased()，将当前资源添加到 MemoryCache
    if (release) {
      listener.onResourceReleased(key, this);
    }
  }
}
```
**onResourceReleased() 存入MemoryCache**
```java
public class Engine implements EngineJobListener,MemoryCache.ResourceRemovedListener,EngineResource.ResourceListener {

  public void onResourceReleased(Key cacheKey, EngineResource<?> resource) {
    //从 ActiveResources 中移除
    activeResources.deactivate(cacheKey);
    if (resource.isMemoryCacheable()) {
      //添加到 MemoryCache
      cache.put(cacheKey, resource);
    } else {
      resourceRecycler.recycle(resource);
    }
  }
}
```
**取出**
- 在加载数据过程中，从 `ActiveResources` 中没有获取到缓存数据后，接下来从 `MemoryCache` 中获取缓存数据。
- 根据 `model、signature、width、height、transformations、resourceClass、transcodeClass、options` 构建 EngineKey（与 `ActiveResources` 是同一个）
- 根据 EngineKey 获取缓存数据
- 有则直接返回，没有则从 `磁盘缓存` 中获取
```java
public class Engine implements EngineJobListener,MemoryCache.ResourceRemovedListener,EngineResource.ResourceListener {

  public <R> LoadStatus load(/*...*/){
    EngineKey key = keyFactory.buildKey(
            model,
            signature,
            width,
            height,
            transformations,
            resourceClass,
            transcodeClass,
            options);
    synchronized (this) {
      memoryResource = loadFromMemory(key, isMemoryCacheable, startTime);
      //...
    }
    cb.onResourceReady(memoryResource, DataSource.MEMORY_CACHE);
    return null;
  }

  private EngineResource<?> loadFromMemory(EngineKey key, boolean isMemoryCacheable, long startTime) {
    //...

    //loadFromCache() 内部最终调用 getEngineResourceFromCache() 获取缓存数据
    EngineResource<?> cached = loadFromCache(key);
    if (cached != null) {
      return cached;
    }
    return null;
  }

  private EngineResource<?> getEngineResourceFromCache(Key key) {
    //从 MemoryCache 中获取
    Resource<?> cached = cache.remove(key);
    final EngineResource<?> result;
    if (cached == null) {
      result = null;
    } else if (cached instanceof EngineResource) {
      result = (EngineResource<?>) cached;
    } else {
      result = new EngineResource<>(cached, /*isMemoryCacheable=*/ true, /*isRecyclable=*/ true, key, /*listener=*/ this);
    }
    return result;
  }
}
```
## ActiveResources
**创建时机与存储结构**
- 在 Engine 构造函数中创建 ActiveResources
- 其内部维护一个 HashMap，key = cacheKey，value = ResourceWeakReference（弱引用对象，持有 key 和 EngineResource）
```java
public class Engine implements EngineJobListener,MemoryCache.ResourceRemovedListener,EngineResource.ResourceListener {
  Engine(/*...*/ActiveResources activeResources,/*...*/ ) {
    //...
    if (activeResources == null) {
      activeResources = new ActiveResources(isActiveResourceRetentionAllowed);
    }
  }
}
```
```java
final class ActiveResources {

  final Map<Key, ResourceWeakReference> activeEngineResources = new HashMap<>();
  private final ReferenceQueue<EngineResource<?>> resourceReferenceQueue = new ReferenceQueue<>();

  //获取
  synchronized EngineResource<?> get(Key key) {
    ResourceWeakReference activeRef = activeEngineResources.get(key);
    if (activeRef == null) {
      return null;
    }
    EngineResource<?> active = activeRef.get();
    return active;
  }

  //存入
  synchronized void activate(Key key, EngineResource<?> resource) {
    ResourceWeakReference toPut =new ResourceWeakReference(key, resource, resourceReferenceQueue, isActiveResourceRetentionAllowed);
    ResourceWeakReference removed = activeEngineResources.put(key, toPut);
    if (removed != null) {
      removed.reset();
    }
  }

  static final class ResourceWeakReference extends WeakReference<EngineResource<?>> {

    ResourceWeakReference(Key key, EngineResource<?> referent, ReferenceQueue<? super EngineResource<?>> queue, boolean isActiveResourceRetentionAllowed) {
      super(referent, queue);
      this.key = Preconditions.checkNotNull(key);
      this.resource =referent.isMemoryCacheable() && isActiveResourceRetentionAllowed
              ? Preconditions.checkNotNull(referent.getResource())
              : null;
      isCacheable = referent.isMemoryCacheable();
    }
  }
}
```
**存入**
- 在数据加载过程中，数据请求、解析、转换完成后，回调`onResourceReady()`，最终回调执行 `EnginJob#notifyCallbacksOfResult()`
- 构建生成 EngineResource，key 根据 model、signature、width、height、transformations、resourceClass、transcodeClass、options 构建，构建时机在 `Engine#load()`
- 调用 `ActiveResources#activate()` 将数据进行缓存，key = 上一步的 key，value = EngineResource。
```java
class EngineJob<R> implements DecodeJob.Callback<R>, Poolable {

  //数据解析、转换结束后，回调 onResourceReady()，其内部调用 notifyCallbacksOfResult()
  void notifyCallbacksOfResult() {
    ResourceCallbacksAndExecutors copy;
    Key localKey;
    EngineResource<?> localResource;
    synchronized (this) {
        // 创建 EngineResource 对象
        engineResource = engineResourceFactory.build(resource, isCacheable, key, resourceListener);

        copy = cbs.copy();
        incrementPendingCallbacks(copy.size() + 1);
        
        localKey = key;
        localResource = engineResource;
    }
    // 回调到 Engine#onEngineJobComplete(), 将数据存储到 activeResources 中
    engineJobListener.onEngineJobComplete(this, localKey, localResource);
    //...
  }
}
```
```java
public class Engine implements EngineJobListener,MemoryCache.ResourceRemovedListener,EngineResource.ResourceListener {
  public synchronized void onEngineJobComplete(EngineJob<?> engineJob, Key key, EngineResource<?> resource) {
    //将数据缓存至 ActiveResources
    if (resource != null && resource.isMemoryCacheable()) {
      activeResources.activate(key, resource);
    }
    //...
  }
}
```
**取出**
- 在加载数据过程中，首先从 `ActiveResources` 中获取缓存数据
- 根据 `model、signature、width、height、transformations、resourceClass、transcodeClass、options` 构建 EngineKey
- 根据 EngineKey 获取缓存数据
- 有则直接返回，没有则从 `MemoryCache` 中获取
```java
public class Engine implements EngineJobListener,MemoryCache.ResourceRemovedListener,EngineResource.ResourceListener {

  public <R> LoadStatus load(/*...*/){
    EngineKey key = keyFactory.buildKey(
            model,
            signature,
            width,
            height,
            transformations,
            resourceClass,
            transcodeClass,
            options);
    synchronized (this) {
      memoryResource = loadFromMemory(key, isMemoryCacheable, startTime);
      //...
    }
    cb.onResourceReady(memoryResource, DataSource.MEMORY_CACHE);
    return null;
  }

  private EngineResource<?> loadFromMemory(EngineKey key, boolean isMemoryCacheable, long startTime) {
    EngineResource<?> active = loadFromActiveResources(key);
    if (active != null) {
      return active;
    }
    //...
    return null;
  }

  private EngineResource<?> loadFromActiveResources(Key key) {
    // 从 ActiveResources 中获取
    EngineResource<?> active = activeResources.get(key);
    if (active != null) {
      active.acquire();
    }
    return active;
  }
}
```
# BitmapPool
**创建时机与存储结构**
- 在 `Glide.with()` 阶段 Glide 构建时期创建。
- 其真正管理是由 `SizeConfigStrategy`(os >= 5。0) 负责
- 复用的条件： width、height、bitmapConfig
```java
public final class GlideBuilder {

  Glide build(@NonNull Context context) {

    if (this.memorySizeCalculator == null) {
      // 内存计算器，内部维护了一些用于后面内存计算的“常量”
      //   如: 
      //      - arrayPool大小 = RAM <= 1G ? 2M : 4M
      //		- 应用最大内存 = 应用内存 * (RAM <= 1G ? 0.33F : 0.4F)
      //		- targetBitmapPool大小 = 屏幕宽 * 屏幕高 * 4 * (os < 8.0 ? 4 : (RAM <=1G ? 0 : 1))
      //      - targetMemoryCache大小 = 屏幕宽 * 屏幕高 * 4 * 2.0F
      //      - 可用内存大小 = 应用最大内存 - arrayPool大小
      //      - bitmapPoolSize = (targetBitmapPool大小 + targetMemoryCache大小 <= 可用内存大小) ? targetBitmapPool大小 : 可用内存大小 / ((os < 8.0 ? 4 : (RAM <=1G ? 0 : 1)) + 2.0F) * (os < 8.0 ? 4 : (RAM <=1G ? 0 : 1))
      //		- memoryCacheSize = (targetBitmapPool大小 + targetMemoryCache大小 <= 可用内存大小) ? targetMemoryCache大小 : 可用内存大小 / ((os < 8.0 ? 4 : (RAM <=1G ? 0 : 1)) + 2.0F) * 2.0F
      this.memorySizeCalculator = (new MemorySizeCalculator.Builder(context)).build();
    }

    if (bitmapPool == null) {
      int size = memorySizeCalculator.getBitmapPoolSize();
      if (size > 0) {
        bitmapPool = new LruBitmapPool(size);
      } else {
        bitmapPool = new BitmapPoolAdapter();
      }
    }
  }
}
```
```java
public class LruBitmapPool implements BitmapPool {

  public LruBitmapPool(long maxSize) {
    // getDefaultStrategy() = os >= 5.0 ? SizeConfigStrategy : AttributeStrategy
    // getDefaultAllowedConfigs() = Bitmap.Config.values(), 如果 os >= 8.0，则移除 HARDWARE
    this(maxSize, getDefaultStrategy(), getDefaultAllowedConfigs());
  }

  LruBitmapPool(long maxSize, LruPoolStrategy strategy, Set<Bitmap.Config> allowedConfigs) {
    this.initialMaxSize = maxSize;
    this.maxSize = maxSize;
    this.strategy = strategy;
    this.allowedConfigs = allowedConfigs;
    this.tracker = new NullBitmapTracker();
  }

  //存入
  public synchronized void put(Bitmap bitmap) {
    //...
    if (!bitmap.isMutable()
        || strategy.getSize(bitmap) > maxSize
        || !allowedConfigs.contains(bitmap.getConfig())) {
      // 不满足条件，直接回收
      bitmap.recycle();
      return;
    }

    final int size = strategy.getSize(bitmap);
    //存入 
    strategy.put(bitmap);
    tracker.add(bitmap);
    //...
  }

  //获取
  public Bitmap get(int width, int height, Bitmap.Config config) {
    //获取可复用的 Bitmap
    Bitmap result = getDirtyOrNull(width, height, config);
    if (result != null) {
      result.eraseColor(Color.TRANSPARENT);
    } else {
      //没有可复用的，直接创建
      result = createBitmap(width, height, config);
    }
    return result;
  }

  private synchronized Bitmap getDirtyOrNull(int width, int height, @Nullable Bitmap.Config config) {
    final Bitmap result = strategy.get(width, height, config != null ? config : DEFAULT_CONFIG);
    //...
    return result;
  }
}
```
**存入**
- 以 Bitmap 为类型的 Resource 子类，重写 `recycle()`，实现将 bitmap 存入 bitmapPool 中。
- Bitmap 为类型的 Resource 子类，如 `BitmapResource`、`BitmapDrawableResource`
```java
public class BitmapResource implements Resource<Bitmap>, Initializable {

  @Override
  public void recycle() {
    bitmapPool.put(bitmap);
  }
}
```
**取出**
- 复用时机
  - 请求获取数据后将 InputStream 转成 Bitmap 时
  - 数据解码结束，开始转换(transformation)时

***复用 - InputStream 转 Bitmap***
```java
public final class Downsampler {
  public Resource<Bitmap> decode(InputStream is, int requestedWidth, int requestedHeight, Options options, DecodeCallbacks callbacks) throws IOException {
    //...
    try {
      // InputStream 转 Bitmap
      Bitmap result = decodeFromWrappedStreams(is, bitmapFactoryOptions, downsampleStrategy, decodeFormat, preferredColorSpace, isHardwareConfigAllowed, requestedWidth, requestedHeight, fixBitmapToRequestedDimensions, callbacks);
      return BitmapResource.obtain(result, bitmapPool);
    } finally { /*...*/ }
  }

  private Bitmap decodeFromWrappedStreams(InputStream is, /*...*/)throws IOException {
    //...
    Bitmap downsampled = decodeStream(is, options, callbacks, bitmapPool);
    //...
    bitmapPool.put(downsampled);
    return rotated;
  }
}
```
***复用 - Transfromation***
```java
//以 BitmapTransformation 为例
public abstract class BitmapTransformation implements Transformation<Bitmap> {

  public final Resource<Bitmap> transform(@NonNull Context context, @NonNull Resource<Bitmap> resource, int outWidth, int outHeight) {
    //获取 bitmapPool
    BitmapPool bitmapPool = Glide.get(context).getBitmapPool();
    Bitmap toTransform = resource.get();
    int targetWidth = outWidth == Target.SIZE_ORIGINAL ? toTransform.getWidth() : outWidth;
    int targetHeight = outHeight == Target.SIZE_ORIGINAL ? toTransform.getHeight() : outHeight;
    //交由子类处理
    Bitmap transformed = transform(bitmapPool, toTransform, targetWidth, targetHeight);

    final Resource<Bitmap> result;
    if (toTransform.equals(transformed)) {
      result = resource;
    } else {
      //构建 bitmapResource 其持有转换后 bitmap 和 bitmapPool
      result = BitmapResource.obtain(transformed, bitmapPool);
    }
    return result;
  }

  protected abstract Bitmap transform(@NonNull BitmapPool pool, @NonNull Bitmap toTransform, int outWidth, int outHeight);
}
```
```java
// 以 CenterCrop 为例。其最终调用 TransformationUtils#centerCrop()
public final class TransformationUtils {

  public static Bitmap centerCrop( @NonNull BitmapPool pool, @NonNull Bitmap inBitmap, int width, int height) {
    //...
    //进行转换处理

    //获取可复用的 Bitmap
    Bitmap result = pool.get(width, height, getNonNullConfig(inBitmap));
    //...
    return result;
  }
}
```
---
# 资料
- [Glide v4: 资源重用](https://muyangmin.github.io/glide-docs-cn/doc/resourcereuse.html)
- [Android 开源库 #6 适可而止！看 Glide 如何把生命周期安排得明明白白 - 掘金](https://juejin.cn/post/6900548494818279432)
- [【带着问题学】Glide做了哪些优化? - 掘金](https://juejin.cn/post/6970683481127043085)
- [Android 图片加载框架 Glide 4.9.0 (二) 从源码的角度分析 Glide 缓存策略 - 掘金](https://juejin.cn/post/6844903953604280328)
- [聊一聊关于Glide在面试中的那些事 - 掘金](https://juejin.cn/post/6844904002551808013)