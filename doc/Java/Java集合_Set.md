---
title: Java 集合 - Set 篇
description: 讲解常见集合(Set) 相关存储结构、扩容方式、新增/删除/清空操作
head:
  - - meta
    - name: description
      content: 讲解常见集合(Set) 相关存储结构、扩容方式、新增/删除/清空操作
  - - meta
    - name: keywords
      content: Java、List、Set、Map、HashMap、
---
# Java 集合 - Set 篇
---
# List、Set、Map 关系图
![](./img/Java集合/List_Set_Map关系图.webp)
<br>

# TreeSet
> - 支持自然顺序访问，但添加、删除、包含等操作相对低效（logn 时间）。
> - 内部维护一个 TreeMap，增删改查都是调用的 Map 操作。具体可看[Java 集合 - Map 篇# TreeMap 部分](./Java集合_Map#treemap)
## 存储结构
```java{9,10}
public class TreeSet<E> extends AbstractSet<E>
    implements NavigableSet<E>, Cloneable, java.io.Serializable
{
    private transient NavigableMap<E,Object> m;

    TreeSet(NavigableMap<E,Object> m) {
        this.m = m;
    }

    public TreeSet() {
        //创建一个 TreeMap
        this(new TreeMap<>());
    }
}
```
## 插入元素
```java{2-4}
public boolean add(E e) {
    // 以添加的元素作为 key，value 为默认的 Object (Object PRESENT = new Object();)
    //  如果插入元素已存在，则返回 false
    return m.put(e, PRESENT)==null;
}
```
## 删除/清空元素
```java{3,8}
//删除
public boolean remove(Object o) {
    return m.remove(o)==PRESENT;
}

//清空
public void clear() {
    m.clear();
}
```
---
# HashSet
> - 理想情况下，如果哈希散列正常，可以提供常数事件的添加、删除、包含等操作，但不保证有序。
> - 内部维护一个 HashMap，增删改查都是调用的 Map 操作。具体可看[Java 集合 - Map 篇# HashMap 部分](./Java集合_Map#hashmap)
## 存储结构
```java{7,8}
public class HashSet<E> extends AbstractSet<E>
    implements Set<E>, Cloneable, java.io.Serializable
{
    private transient HashMap<E,Object> map;

    public HashSet() {
        // 内部维护一个 HashMap
        map = new HashMap<>();
    }
}
```
## 插入元素
```java{2,3}
public boolean add(E e) {
    // 与 TreeSet 一样，将插入元素作为 key，value 为默认的 Object
    //  如果插入元素已存在，则返回 false
    return map.put(e, PRESENT)==null;
}
```
## 删除/清空元素
```java{3,8}
//删除
public boolean remove(Object o) {
    return map.remove(o)==PRESENT;
}

//清空
public void clear() {
    map.clear();
}
```
---
# LinkedHashSet
> - 继承自 HashSet，通过 HashSet 的构造函数来创建。
> - 增删改查都是调用父类。
> - 内部维护一个 LinkedHashMap，增删改查都是调用 Map 操作。具体可看[Java 集合 - Map 篇# LinkedHashMap 部分](./Java集合_Map#linkedhashmap)
## 存储结构
```java{1,5-10}
public class LinkedHashSet<E> extends HashSet<E>
    implements Set<E>, Cloneable, java.io.Serializable
{
    public LinkedHashSet() {
        // super 为 HashSet，通过最后一个入参(dummy)来区分是创建 LinkedHashSet 还是 HashSet。
        // 此处 HashSet 的构造方法如下： 
        // HashSet(int initialCapacity, float loadFactor, boolean dummy) {
        //     map = new LinkedHashMap<>(initialCapacity, loadFactor);
        // }
        super(16, .75f, true);
    }
}
```