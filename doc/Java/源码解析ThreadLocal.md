---
title: 源码解读 ThreadLocal
description: 从源码角度解答 ThreadLocal 是如何做到线程隔离存储数据的.
head:
  - - meta
    - name: description
      content: ThreadLocal 如何做到线程隔离的？
  - - meta
    - name: keywords
      content: Java、ThreadLocal
---
# 源码解读 ThreadLocal
---
# ThreadLocal 是什么？
ThreadLocal 是线程内部的数据存储类，线程间无法获取对方的 ThreadLocal 存储的数据。
# ThreadLocal 使用场景
1.  系统中的 Looper 
```java
public final class Looper {
	static final ThreadLocal<Looper> sThreadLocal = new ThreadLocal<Looper>();

	private static void prepare(boolean quitAllowed) {
		if (sThreadLocal.get() != null) {
			throw new RuntimeException("Only one Looper may be created per thread");
		}
		sThreadLocal.set(new Looper(quitAllowed));
	}
}
```
2.  监听器或者嵌套参数
例如：函数调用栈很深事，如果要逐层传递成本太高。此时如果所有函数调用都在同线程下，可以考虑将监听器放在 ThreadLocal 中，需要时可以直接使用 。
## 使用注意事项
- 数据污染: 线程复用时，可能会 get 之前的值。
- 内存泄露: 1. 存储的内容生命周期与线程一致，需要警惕内存泄露问题。2. 若 ThreadLocal 为静态变量，因为 ThreadLocal 用作存储时的 Key，亦可操作内存泄露问题。

解决办法：
- 在使用完毕后及时 remove
- 使用弱引用持有存储数据

<br>

# ThreadLocal 原理
> Q: ThreadLocal 是怎么做到线程间数据隔离的呢？<br>
> A: 首次使用时会创建一个 Map 赋值给线程的 threadLocals 变量。后面存储数据格式为：key = 创建的 ThreadLocal 对象，value = 传入的值

## set()过程
```java{2,3,7}
public void set(T value) {
    Thread t = Thread.currentThread(); //获取当前线程 [!code focus]
    ThreadLocalMap map = getMap(t); //首次调用时为 null
    if (map != null)
        map.set(this, value);
    else
        createMap(t, value);  //首次调用走这里
}
```
```java
void createMap(Thread t, T firstValue) {
    t.threadLocals = new ThreadLocalMap(this, firstValue);  //将 ThreadLocalMap 赋值给 Thread 的 threadLocals。这是实现每个线程独立的关键
}
```
```java
// ThreadLocalMap 是 ThreadLocal 的静态内部类        
ThreadLocalMap(ThreadLocal<?> firstKey, Object firstValue) {
    table = new Entry[INITIAL_CAPACITY];  //创建了size=16的 Entry 数组
    int i = firstKey.threadLocalHashCode & (INITIAL_CAPACITY - 1);  //获取存储的index
    table[i] = new Entry(firstKey, firstValue); //将数据存在 Entry 中放到数组中
    size = 1;
    setThreshold(INITIAL_CAPACITY);
}
```
```java
static class Entry extends WeakReference<ThreadLocal<?>> {
    /** The value associated with this ThreadLocal. */
    Object value;

    Entry(ThreadLocal<?> k, Object v) {
        super(k);
        value = v;
    }
}
```
## get()过程
```java{2,3,5}
public T get() {
    Thread t = Thread.currentThread();  //获取当前线程
    ThreadLocalMap map = getMap(t);  //获取ThreadLocalMap，即 Thread.threadLocals。就可以实现获取当前线程存储的值
    if (map != null) {
        ThreadLocalMap.Entry e = map.getEntry(this);  //根据特定算法获取到index，再通过index获取到Entry
        if (e != null) {
            @SuppressWarnings("unchecked")
            T result = (T)e.value;
            return result;
        }
    }
    return setInitialValue(); //如果不存在 ThreadLocalMap,则说明没有set过，这里先创建好存储结构，并存入一个null
}
```
```java
    private Entry getEntry(ThreadLocal<?> key) {
        int i = key.threadLocalHashCode & (table.length - 1);
        Entry e = table[i];
        if (e != null && e.refersTo(key))
            return e;
        else
            return getEntryAfterMiss(key, i, e);
    }
```
```java
private T setInitialValue() {
    T value = initialValue(); //直接返回的 null
    Thread t = Thread.currentThread();
    ThreadLocalMap map = getMap(t);
    if (map != null)
        map.set(this, value);
    else
        createMap(t, value);
    return value;
}
```