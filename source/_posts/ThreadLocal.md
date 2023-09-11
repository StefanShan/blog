---
title: ThreadLocal 如何实现线程间数据隔离？
date: 2022/11/17
categories:
- [Android]
- [源码解读]
tags:
- ThreadLocal
---

> 源码基于 Android API 31

## ThreadLocal 是什么？
ThreadLocal 是线程内部的数据存储类，线程间无法获取对方的 ThreadLocal 存储的数据。
##  ThreadLocal 使用场景

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

2.  监听器或者嵌套参数<br />例如：函数调用栈很深事，如果要逐层传递成本太高。此时如果所有函数调用都在同线程下，可以考虑将监听器放在 ThreadLocal 中，需要时可以直接使用 
##  ThreadLocal 原理
ThreadLocal 是怎么做到线程间数据隔离的呢？
<!-- more -->
### set()过程
```java
    public void set(T value) {
        Thread t = Thread.currentThread(); //获取当前线程
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
### get()过程
```java
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
            // Android-changed: Use refersTo()
            if (e != null && e.refersTo(key))
                return e;
            else
                return getEntryAfterMiss(key, i, e);
        }
```
```java
    private T setInitialValue() {
        T value = initialValue();
        Thread t = Thread.currentThread();
        ThreadLocalMap map = getMap(t);
        if (map != null)
            map.set(this, value);
        else
            createMap(t, value);
        return value;
    }

    protected T initialValue() {
        return null;
    }
```
